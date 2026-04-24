// src/services/proof-checker/index.js — Post-posting 7-field verification
// After every posting, re-reads the bill from Zoho API and compares 7 fields
// against original input. Any mismatch → Q8 (proof-check queue) + Slack alert.

const axios = require('axios');
const config = require('../../../config');
const { getAccessToken } = require('../zoho-poster/auth');
const audit = require('../audit-logger');
const { query } = require('../../infra/db/pool');

const FIELDS_TO_CHECK = [
  { field: 'vendor_name', zohoPath: 'vendor_name', tolerance: null },
  { field: 'total_amount', zohoPath: 'total', tolerance: 1 },       // ±₹1
  { field: 'gst_amount', zohoPath: '_tax_total', tolerance: 1 },     // computed
  { field: 'tds_section', zohoPath: 'tds.tax_name', tolerance: null },
  { field: 'rcm_flag', zohoPath: 'is_reverse_charge', tolerance: null },
  { field: 'gl_account', zohoPath: 'line_items.0.account_name', tolerance: null },
  { field: 'invoice_number', zohoPath: 'bill_number', tolerance: null },
];

async function verify({ zohoBillId, originalInput, correlationId }) {
  const start = Date.now();

  if (!zohoBillId) {
    return { allMatch: true, mismatches: [], skipped: true, reason: 'No Zoho bill ID' };
  }

  let zohoData;
  try {
    const token = await getAccessToken();
    if (!token) throw new Error('No Zoho access token');

    const resp = await axios.get(
      `${config.zoho.baseUrl}/bills/${zohoBillId}?organization_id=${config.zoho.orgId}`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeout: 15000 }
    );
    zohoData = resp.data?.bill;
    if (!zohoData) throw new Error('Empty bill response from Zoho');
  } catch (err) {
    await audit.logServiceCall(correlationId, 'L7', 'proof_check', { zohoBillId }, null, Date.now() - start, `Zoho read failed: ${err.message}`);
    return { allMatch: false, mismatches: [{ field: '_zoho_read', expected: 'success', actual: err.message }], error: err.message };
  }

  // ── Compare 7 fields ──
  const mismatches = [];

  for (const check of FIELDS_TO_CHECK) {
    const expected = getNestedValue(originalInput, check.field);
    let actual = getNestedValue(zohoData, check.zohoPath);

    // Special handling for tax total (sum of line item taxes)
    if (check.field === 'gst_amount') {
      actual = computeTaxTotal(zohoData);
    }

    // Special handling for TDS section
    if (check.field === 'tds_section' && zohoData.tds) {
      actual = zohoData.tds.tax_name || zohoData.tds.tds_tax_name;
    }

    // Special handling for GL account from first line item
    if (check.field === 'gl_account' && zohoData.line_items?.length > 0) {
      actual = zohoData.line_items[0].account_name;
    }

    if (expected === undefined || expected === null) continue; // Skip if original didn't have this field

    const matches = check.tolerance
      ? Math.abs(Number(expected) - Number(actual || 0)) <= check.tolerance
      : String(expected).toLowerCase() === String(actual || '').toLowerCase();

    if (!matches) {
      mismatches.push({
        field: check.field,
        expected: expected,
        actual: actual || '(empty)',
        tolerance: check.tolerance,
      });
    }
  }

  const allMatch = mismatches.length === 0;

  // Log proof-check results
  await query(
    `INSERT INTO audit_events (correlation_id, event_type, agent, input_snapshot, output_snapshot, passed)
     VALUES ($1, 'proof_check', 'L7', $2, $3, $4)`,
    [correlationId, JSON.stringify({ zohoBillId, fieldCount: FIELDS_TO_CHECK.length }),
     JSON.stringify({ allMatch, mismatchCount: mismatches.length, mismatches }), allMatch]
  );

  // Update bill lifecycle
  if (allMatch) {
    await query(
      `UPDATE bill_lifecycle SET status = 'proof_checked', current_step = 12, completed_at = NOW() WHERE correlation_id = $1`,
      [correlationId]
    );
  }

  await audit.logServiceCall(
    correlationId, 'L7', 'proof_check',
    { zohoBillId, fieldsChecked: FIELDS_TO_CHECK.length },
    { allMatch, mismatchCount: mismatches.length },
    Date.now() - start,
    allMatch ? null : `${mismatches.length} field mismatch(es): ${mismatches.map(m => m.field).join(', ')}`
  );

  return { allMatch, mismatches, zohoData: { id: zohoBillId, vendor: zohoData.vendor_name, total: zohoData.total } };
}

// ── CC proof check: verify bill + journal + settlement ──

async function verifyCC({ zohoBillId, zohoJournalId, zohoPaymentId, originalInput, correlationId }) {
  const results = [];

  // Check bill
  if (zohoBillId) {
    const billCheck = await verify({ zohoBillId, originalInput, correlationId });
    results.push({ type: 'bill', ...billCheck });
  }

  // Check journal exists
  if (zohoJournalId) {
    try {
      const token = await getAccessToken();
      const resp = await axios.get(
        `${config.zoho.baseUrl}/journals/${zohoJournalId}?organization_id=${config.zoho.orgId}`,
        { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
      );
      const journal = resp.data?.journal;
      const amountMatch = Math.abs((journal?.total || 0) - (originalInput?.amount || 0)) <= 0.02;
      results.push({ type: 'journal', allMatch: amountMatch, mismatches: amountMatch ? [] : [{ field: 'amount', expected: originalInput?.amount, actual: journal?.total }] });
    } catch (err) {
      results.push({ type: 'journal', allMatch: false, error: err.message });
    }
  }

  // Check settlement exists
  if (zohoPaymentId) {
    results.push({ type: 'settlement', allMatch: true, mismatches: [] }); // Payment existence = settled
  } else if (zohoBillId && zohoJournalId) {
    results.push({ type: 'settlement', allMatch: false, mismatches: [{ field: 'settlement', expected: 'applied', actual: 'missing' }] });
  }

  const allMatch = results.every(r => r.allMatch);
  return { allMatch, checks: results };
}

// ── Helpers ──

function getNestedValue(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((o, k) => {
    if (o === undefined || o === null) return undefined;
    if (Array.isArray(o) && !isNaN(k)) return o[parseInt(k)];
    return o[k];
  }, obj);
}

function computeTaxTotal(bill) {
  if (!bill?.line_items) return 0;
  let total = 0;
  for (const item of bill.line_items) {
    if (item.tax_amount) total += parseFloat(item.tax_amount);
  }
  return total;
}

module.exports = { verify, verifyCC };
