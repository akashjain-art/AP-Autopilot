// src/services/proof-checker/master-validator.js — 8 final gate checks
// MV-001 to MV-008: no accounting entry is posted without passing the Master Validator.
// This is L5 — the last gate after all validation and approvals.

const { query } = require('../../infra/db/pool');
const audit = require('../audit-logger');
const config = require('../../../config');

const GATES = [
  { id: 'MV-001', name: 'All applicable rules run', check: checkAllRulesRan },
  { id: 'MV-002', name: 'Zero critical exceptions unresolved', check: checkNoCriticalExceptions },
  { id: 'MV-003', name: 'All approvals obtained (or exempt)', check: checkApprovals },
  { id: 'MV-004', name: 'Score gate passed', check: checkScoreGate },
  { id: 'MV-005', name: 'GST/RCM/TDS correct', check: checkCompliance },
  { id: 'MV-006', name: 'Vendor active + GSTIN match', check: checkVendor },
  { id: 'MV-007', name: 'Amount within tolerance (±₹1)', check: checkAmount },
  { id: 'MV-008', name: 'No duplicates detected', check: checkNoDuplicates },
];

async function validate({ correlationId, billData, ruleResults, vendorResult, scoreResult, sourceType }) {
  const start = Date.now();
  const results = [];
  let blocked = false;

  for (const gate of GATES) {
    const gateResult = await gate.check({ correlationId, billData, ruleResults, vendorResult, scoreResult, sourceType });
    results.push({
      id: gate.id,
      name: gate.name,
      passed: gateResult.passed,
      detail: gateResult.detail,
    });
    if (!gateResult.passed) blocked = true;

    await audit.logRuleCheck(correlationId, {
      rule_id: gate.id,
      name: gate.name,
      tab: 'Master Validator',
      stage: 'L5',
      passed: gateResult.passed,
      severity: 'critical',
      penalty: gateResult.passed ? 0 : -30,
      queue_bucket: null,
      detail: gateResult.detail,
    }, 0);
  }

  const output = {
    passed: !blocked,
    gates: results,
    failedGates: results.filter(r => !r.passed).map(r => r.id),
    duration: Date.now() - start,
  };

  await audit.logServiceCall(
    correlationId, 'L5', 'master_validator',
    { gateCount: GATES.length, sourceType },
    { passed: output.passed, failedCount: output.failedGates.length },
    output.duration,
    blocked ? `BLOCKED: ${output.failedGates.join(', ')}` : null
  );

  return output;
}

// ── Gate implementations ──

async function checkAllRulesRan({ ruleResults, sourceType }) {
  if (!ruleResults || ruleResults.length === 0) {
    return { passed: false, detail: 'No rule results found — validation incomplete' };
  }
  // Zoho should have at least 20 rules, CC at least 5
  const minRules = sourceType === 'cc' ? 5 : 20;
  const passed = ruleResults.length >= minRules;
  return { passed, detail: `${ruleResults.length} rules executed (minimum: ${minRules})` };
}

async function checkNoCriticalExceptions({ correlationId }) {
  const result = await query(
    `SELECT COUNT(*) as cnt FROM exceptions
     WHERE correlation_id = $1 AND status = 'open'
     AND rule_failures::text LIKE '%critical%'`,
    [correlationId]
  );
  const openCritical = parseInt(result.rows[0]?.cnt || 0);
  return { passed: openCritical === 0, detail: openCritical === 0 ? 'No open critical exceptions' : `${openCritical} critical exception(s) still open` };
}

async function checkApprovals({ sourceType, billData, correlationId }) {
  if (sourceType === 'cc') {
    return { passed: true, detail: 'CC exempt — function head approved at swipe' };
  }
  // Check if bill has been approved
  const result = await query(
    `SELECT status FROM bill_lifecycle WHERE correlation_id = $1`,
    [correlationId]
  );
  const status = result.rows[0]?.status;
  const approved = status === 'approved' || status === 'posted' || config.deployMode === 'draft';
  return {
    passed: approved,
    detail: approved
      ? (config.deployMode === 'draft' ? 'Phase 1 draft mode — approval check bypassed' : `Approval status: ${status}`)
      : `Approval pending (status: ${status})`,
  };
}

async function checkScoreGate({ scoreResult, sourceType }) {
  if (sourceType === 'cc') {
    return { passed: true, detail: 'CC exempt — no score gate' };
  }
  if (!scoreResult) {
    return { passed: false, detail: 'Score not calculated' };
  }
  const threshold = config.scoring.approvalThreshold;
  const passed = scoreResult.score >= threshold || config.deployMode === 'draft';
  return {
    passed,
    detail: `Score: ${scoreResult.score} (threshold: ${threshold})${config.deployMode === 'draft' ? ' [Phase 1: bypassed]' : ''}`,
  };
}

async function checkCompliance({ ruleResults }) {
  const complianceRules = (ruleResults || []).filter(r =>
    r.rule_id?.startsWith('GST-') || r.rule_id?.startsWith('TDS-') || r.rule_id?.includes('RCM')
  );
  const failedCompliance = complianceRules.filter(r => !r.passed && r.severity === 'critical');
  return {
    passed: failedCompliance.length === 0,
    detail: failedCompliance.length === 0
      ? `${complianceRules.length} compliance rules checked — all passed`
      : `${failedCompliance.length} compliance failure(s): ${failedCompliance.map(r => r.rule_id).join(', ')}`,
  };
}

async function checkVendor({ vendorResult }) {
  if (!vendorResult) return { passed: false, detail: 'Vendor not verified' };
  const passed = vendorResult.matched && vendorResult.isActive !== false;
  return {
    passed,
    detail: passed
      ? `Vendor verified: ${vendorResult.vendorName} (${vendorResult.vendorId})`
      : `Vendor issue: matched=${vendorResult.matched}, active=${vendorResult.isActive}`,
  };
}

async function checkAmount({ billData }) {
  if (!billData?.amount || billData.amount <= 0) {
    return { passed: false, detail: `Invalid amount: ${billData?.amount}` };
  }
  // If we have both PDF amount and Zoho amount, compare
  if (billData.pdfAmount && billData.zohoAmount) {
    const diff = Math.abs(billData.pdfAmount - billData.zohoAmount);
    return { passed: diff <= 1, detail: `PDF: ₹${billData.pdfAmount}, Zoho: ₹${billData.zohoAmount}, diff: ₹${diff}` };
  }
  return { passed: true, detail: `Amount: ₹${billData.amount} (>0 ✓)` };
}

async function checkNoDuplicates({ correlationId }) {
  const result = await query(
    `SELECT COUNT(*) as cnt FROM exceptions
     WHERE correlation_id = $1 AND queue_bucket = 'Q4' AND status = 'open'`,
    [correlationId]
  );
  const hasDup = parseInt(result.rows[0]?.cnt || 0) > 0;
  return { passed: !hasDup, detail: hasDup ? 'Duplicate flag open in Q4' : 'No duplicate flags' };
}

module.exports = { validate, GATES };
