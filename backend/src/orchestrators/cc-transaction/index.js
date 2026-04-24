// src/orchestrators/cc-transaction/index.js — CC Transaction Orchestrator
// 13-step flow for HSBC credit card transactions
// No documents. No business approval. No score gate.
// 3-step atomic pipeline (bill + journal + settlement) via saga pattern.

const audit = require('../../services/audit-logger');
const vendor = require('../../services/vendor');
const glClassifier = require('../../services/gl-classifier');
const rcmEngine = require('../../services/rcm-engine');
const duplicateChecker = require('../../services/duplicate-checker');
const exceptionRouter = require('../../services/exception-router');
const { CCSaga } = require('./saga');
const { query } = require('../../infra/db/pool');
const config = require('../../../config');

// ── CC Skip rules REMOVED — all transactions route to exception queues ──
// CC-SKIP-01 (IGST Assessment) → Q5 (Amount/Type) for Saurav to confirm govt payment
// CC-SKIP-02 (Amount ≤ 0) → Q5 (Amount mismatch) for Tushar to match against original transaction
// Rationale: no transaction should be invisible to all humans. Every line item needs
// at least one person to see it and sign off — even if no action is needed.
const SKIP_RULES = []; // Silent skipping removed per controls decision 2026-04-22

async function processTransaction(transaction) {
  const correlationId = audit.generateCorrelationId('cc', transaction.id);
  const failures = [];
  const startTime = Date.now();

  console.log(`[CC-ORCH] Processing ${transaction.id}: ${transaction.merchant} ₹${transaction.amount}`);

  // ── Create bill_lifecycle record ──
  await query(
    `INSERT INTO bill_lifecycle (correlation_id, source, merchant_string, amount, card_last4, status, deploy_mode)
     VALUES ($1, 'cc', $2, $3, $4, 'processing', $5)
     ON CONFLICT (correlation_id) DO NOTHING`,
    [correlationId, transaction.merchant, transaction.amount, transaction.card, config.deployMode]
  );

  await audit.logPipelineStep(correlationId, 'A1', 'step_1', `Received CC transaction: ${transaction.merchant}`);

  // ── Step 2: All transactions continue — no silent skipping ──
  // (IGST Assessment and Amount ≤ 0 are caught below and routed to Q5)
  await audit.logPipelineStep(correlationId, 'A1', 'step_2', 'All transactions route through pipeline — no silent skipping');

  // ── Step 2: IGST Assessment → Q5 (was CC-SKIP-01) ──
  const isIGSTAssessment = (transaction.description || '').toLowerCase().includes('igst assessment')
    || (transaction.merchant || '').toLowerCase().includes('igst assessment');

  if (isIGSTAssessment) {
    failures.push({
      rule_id: 'CC-SKIP-01', queue_bucket: 'Q5', severity: 'warning',
      detail: `IGST Assessment detected — government self-assessment payment. Saurav to confirm this is intentional and not a vendor expense.`,
      name: 'IGST Assessment — confirm not vendor bill'
    });
  }

  // ── Step 2b: Negative amount (reversal) → Q5 (was CC-SKIP-02) ──
  if (transaction.amount <= 0) {
    failures.push({
      rule_id: 'CC-SKIP-02', queue_bucket: 'Q5', severity: 'critical',
      detail: `Amount ≤ 0 (₹${transaction.amount}). This is a reversal or credit. Tushar to match against original transaction and confirm. Controls risk: unmatched reversals can indicate fraudulent credit.`,
      name: 'Negative/zero amount — match against original'
    });
  }

  // ── Step 3: Merchant → vendor match (4-step) ──
  const vendorResult = await vendor.lookup({
    identifier: transaction.merchant,
    sourceType: 'cc',
    correlationId,
  });

  if (!vendorResult.matched && vendorResult.matchMethod !== 'fuzzy') {
    failures.push({ rule_id: 'CC-MATCH-04', queue_bucket: 'Q3', severity: 'critical',
      detail: `No vendor match for "${transaction.merchant}"`, name: 'Vendor not found' });
  }

  // ── Step 4: Bank vendor detection ──
  const isBankCharge = vendorResult.isBank === true;
  if (isBankCharge) {
    await audit.logPipelineStep(correlationId, 'A1', 'step_4', `Bank vendor detected: ${vendorResult.vendorName}`);
  }

  // ── Step 5: GL classify via merchant keywords ──
  const glResult = await glClassifier.classify({
    text: `${transaction.merchant} ${transaction.description || ''}`,
    sourceType: 'cc',
    glOverride: vendorResult.note?.includes('GL override') ? vendorResult.note.split('GL override: ')[1] : null,
    correlationId,
  });

  if (glResult.isManual) {
    failures.push({ rule_id: 'GL-015', queue_bucket: 'Q7', severity: 'warning',
      detail: `GL-015: cannot classify "${transaction.merchant}"`, name: 'GL mapping unclear' });
  }

  // ── Step 6: Restaurant detection (handled by GL classifier) ──
  if (glResult.isRestaurant) {
    await audit.logPipelineStep(correlationId, 'A1', 'step_6', 'Restaurant → Staff Welfare GL override');
  }

  // ── Step 7: Card holder mapping ──
  const cardHolder = config.cardHolders[transaction.card];
  const ccAccount = cardHolder || { holder: 'Default', zohoAccountId: config.zohoIds.defaultHsbcCc, accountName: 'HSBC CC - Default (FLAGGED)' };
  if (!cardHolder) {
    await audit.logPipelineStep(correlationId, 'A1', 'step_7', `Card ****${transaction.card} NOT MAPPED → using default`);
  }

  // ── Step 8: RCM check (overseas merchant) ──
  const rcmResult = await rcmEngine.check({
    vendorGstTreatment: vendorResult.gstTreatment,
    isOverseas: transaction.isOverseas || false,
    vendorGstin: null, // CC transactions don't have vendor GSTIN
    currency: transaction.currency,
    vendorCountry: transaction.vendorCountry,
    correlationId,
  });

  if (rcmResult.needsQ1Review) {
    failures.push({ rule_id: 'CC-RCM-01', queue_bucket: 'Q1', severity: 'critical',
      detail: rcmResult.flagReason, name: 'RCM overseas conflict' });
  }

  // ── Step 9: Duplicate check ──
  const dupResult = await duplicateChecker.check({
    vendorId: vendorResult.vendorId,
    amount: transaction.amount,
    date: transaction.date,
    sourceType: 'cc',
    merchantString: transaction.merchant,
    correlationId,
  });

  if (dupResult.hasDuplicate) {
    failures.push({ rule_id: dupResult.allMatches[0].ruleId, queue_bucket: 'Q4', severity: 'critical',
      detail: dupResult.allMatches[0].detail, name: 'Duplicate detected' });
  }

  // ── Route to exception if any failures ──
  if (failures.length > 0) {
    await exceptionRouter.route({
      failures, sourceType: 'cc', correlationId,
      billContext: { vendorName: vendorResult.vendorName, merchantString: transaction.merchant, amount: transaction.amount },
    });
    return { correlationId, status: 'exception', failures, duration: Date.now() - startTime };
  }

  // ── Update bill_lifecycle with validated data ──
  await query(
    `UPDATE bill_lifecycle SET
      vendor_id = $1, vendor_name = $2, gl_account = $3, gl_rule = $4,
      is_bank_charge = $5, rcm_applied = $6, match_method = $7,
      current_step = 10, status = 'posting', validated_at = NOW()
     WHERE correlation_id = $8`,
    [vendorResult.vendorId, vendorResult.vendorName, glResult.glAccount, glResult.glRule,
     isBankCharge, rcmResult.rcmRequired, vendorResult.matchMethod, correlationId]
  );

  // ── Steps 10-12: 3-step saga (bill → journal → settlement) ──
  const saga = new CCSaga(correlationId, {
    id: transaction.id,
    vendorId: vendorResult.vendorId,
    amount: transaction.amount,
    enteredAt: transaction.date,
    billPayload: buildBillPayload(transaction, vendorResult, glResult, rcmResult, ccAccount),
    journalPayload: buildJournalPayload(transaction, vendorResult, ccAccount),
  });

  const sagaResult = await saga.execute();

  // Update bill_lifecycle with posting results
  await query(
    `UPDATE bill_lifecycle SET
      zoho_bill_id = $1, zoho_journal_id = $2, zoho_payment_id = $3,
      status = $4, current_step = 13, posted_at = NOW(), completed_at = NOW()
     WHERE correlation_id = $5`,
    [sagaResult.billId, sagaResult.journalId, sagaResult.paymentId,
     sagaResult.completed ? 'posted' : 'failed', correlationId]
  );

  // ── Step 13: Proof-check would run here ──
  // TODO: Agent 3 implements proof-checker service

  const duration = Date.now() - startTime;
  console.log(`[CC-ORCH] ${correlationId} completed in ${duration}ms: ${sagaResult.completed ? 'SUCCESS' : 'FAILED'}`);

  return { correlationId, status: sagaResult.completed ? 'posted' : 'failed', sagaResult, duration };
}

// ── Build Zoho API payloads ──

function buildBillPayload(txn, vendorResult, glResult, rcmResult, ccAccount) {
  const lineItem = {
    account_id: glResult.glRule === 'GL-015' ? config.zohoIds.suspenseAccount : undefined,
    account_name: glResult.glAccount,
    description: `CC: ${txn.merchant} | ${txn.description || ''} | Card ****${txn.card}`,
    amount: txn.amount,
    item_order: 1,
  };

  if (rcmResult.rcmRequired) {
    lineItem.tax_id = rcmResult.taxId;
    lineItem.is_reverse_charge = true;
  }

  return {
    vendor_id: vendorResult.vendorId,
    bill_number: `HSBC-${txn.id}`,
    date: txn.date,
    due_date: txn.date,
    line_items: [lineItem],
    is_reverse_charge: rcmResult.rcmRequired,
    notes: `Auto-generated from HSBC CC statement. Correlation: ${txn.correlationId || ''}`,
  };
}

function buildJournalPayload(txn, vendorResult, ccAccount) {
  return {
    journal_date: txn.date,
    reference_number: `HSBC-${txn.id}-JRN`,
    notes: `CC journal: ${vendorResult.vendorName} via card ****${txn.card}`,
    line_items: [
      { account_id: vendorResult.vendorId, debit_or_credit: 'debit', amount: txn.amount, description: `CC payment to ${vendorResult.vendorName}` },
      { account_id: ccAccount.zohoAccountId, debit_or_credit: 'credit', amount: txn.amount, description: `HSBC CC ****${txn.card} (${ccAccount.holder})` },
    ],
  };
}

// ── Batch processing for CC statements ──

async function processBatch(transactions) {
  const batchId = `CC-BATCH-${Date.now()}`;
  console.log(`[CC-BATCH] Starting batch ${batchId}: ${transactions.length} transactions`);

  await query(
    `INSERT INTO batch_tracking (batch_id, source, total_items, remaining, status)
     VALUES ($1, 'cc', $2, $2, 'processing')`,
    [batchId, transactions.length]
  );

  const results = [];
  for (let i = 0; i < transactions.length; i++) {
    const txn = transactions[i];
    try {
      const result = await processTransaction(txn);
      results.push(result);

      const field = result.status === 'skipped' ? 'skipped' : result.status === 'posted' ? 'processed' : 'failed';
      await query(
        `UPDATE batch_tracking SET ${field} = ${field} + 1, remaining = remaining - 1 WHERE batch_id = $1`,
        [batchId]
      );
    } catch (err) {
      console.error(`[CC-BATCH] Transaction ${txn.id} failed:`, err.message);
      results.push({ correlationId: null, status: 'error', error: err.message });
      await query(
        `UPDATE batch_tracking SET failed = failed + 1, remaining = remaining - 1 WHERE batch_id = $1`,
        [batchId]
      );
    }
  }

  await query(
    `UPDATE batch_tracking SET status = 'completed', completed_at = NOW() WHERE batch_id = $1`,
    [batchId]
  );

  console.log(`[CC-BATCH] Batch ${batchId} complete: ${results.filter(r => r.status === 'posted').length} posted, ${results.filter(r => r.status === 'skipped').length} skipped, ${results.filter(r => r.status === 'exception' || r.status === 'failed').length} failed`);
  return { batchId, results };
}

module.exports = { processTransaction, processBatch };
