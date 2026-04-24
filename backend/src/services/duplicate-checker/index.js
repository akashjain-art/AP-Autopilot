// src/services/duplicate-checker/index.js — Duplicate detection
// Checks: exact invoice# + vendor, fuzzy invoice#, cross-vendor (amount+date), CC merchant+amount+date
// Uses PostgreSQL bill_lifecycle table for lookups

const Fuse = require('fuse.js');
const { query } = require('../../infra/db/pool');
const audit = require('../audit-logger');

async function check({ invoiceNumber, vendorId, amount, date, sourceType, merchantString, correlationId }) {
  const start = Date.now();
  const results = [];

  if (sourceType === 'zoho' && invoiceNumber) {
    // ── A1-020: Exact invoice# + same vendor ──
    const exact = await query(
      `SELECT correlation_id, invoice_number, vendor_name, amount, status
       FROM bill_lifecycle
       WHERE source = 'zoho' AND invoice_number = $1 AND vendor_id = $2
         AND status NOT IN ('voided', 'skipped')
       LIMIT 1`,
      [invoiceNumber, vendorId]
    );
    if (exact.rows.length > 0) {
      results.push({
        ruleId: 'A1-020',
        matchType: 'exact',
        duplicateRef: exact.rows[0].correlation_id,
        detail: `Exact match: invoice ${invoiceNumber} already exists for this vendor (${exact.rows[0].status})`,
      });
    }

    // ── A1-021: Fuzzy invoice# match ──
    if (results.length === 0) {
      const recent = await query(
        `SELECT correlation_id, invoice_number, vendor_name, amount
         FROM bill_lifecycle
         WHERE source = 'zoho' AND vendor_id = $1
           AND status NOT IN ('voided', 'skipped')
           AND entered_at > NOW() - INTERVAL '90 days'`,
        [vendorId]
      );
      if (recent.rows.length > 0) {
        const fuse = new Fuse(recent.rows, { keys: ['invoice_number'], threshold: 0.2, includeScore: true });
        const fuzzyMatches = fuse.search(invoiceNumber);
        if (fuzzyMatches.length > 0 && fuzzyMatches[0].score < 0.2) {
          results.push({
            ruleId: 'A1-021',
            matchType: 'fuzzy',
            duplicateRef: fuzzyMatches[0].item.correlation_id,
            detail: `Fuzzy match: "${invoiceNumber}" similar to "${fuzzyMatches[0].item.invoice_number}" (score: ${Math.round((1 - fuzzyMatches[0].score) * 100)}%)`,
          });
        }
      }
    }
  }

  // ── A1-022: Cross-vendor duplicate (same amount + date) ──
  if (amount && date) {
    const crossVendor = await query(
      `SELECT correlation_id, vendor_name, invoice_number, amount
       FROM bill_lifecycle
       WHERE source = $1 AND amount = $2
         AND DATE(entered_at) = $3::date
         AND ($4::text IS NULL OR vendor_id != $4)
         AND status NOT IN ('voided', 'skipped')
       LIMIT 3`,
      [sourceType, amount, date, vendorId]
    );
    if (crossVendor.rows.length > 0) {
      results.push({
        ruleId: 'A1-022',
        matchType: 'cross_vendor',
        duplicateRef: crossVendor.rows[0].correlation_id,
        detail: `Cross-vendor: same amount ₹${amount} on ${date} from ${crossVendor.rows[0].vendor_name}`,
      });
    }
  }

  // ── DUP-001: CC duplicate (merchant + amount + date) ──
  if (sourceType === 'cc' && merchantString) {
    const ccDup = await query(
      `SELECT correlation_id, merchant_string, amount
       FROM bill_lifecycle
       WHERE source = 'cc' AND merchant_string = $1 AND amount = $2
         AND DATE(entered_at) = $3::date
         AND status NOT IN ('voided', 'skipped')
       LIMIT 1`,
      [merchantString, amount, date]
    );
    if (ccDup.rows.length > 0) {
      results.push({
        ruleId: 'DUP-001',
        matchType: 'cc_duplicate',
        duplicateRef: ccDup.rows[0].correlation_id,
        detail: `CC duplicate: "${merchantString}" ₹${amount} on ${date} already processed`,
      });
    }
  }

  const hasDuplicate = results.length > 0;
  const output = {
    hasDuplicate,
    matchType: hasDuplicate ? results[0].matchType : null,
    duplicateRef: hasDuplicate ? results[0].duplicateRef : null,
    allMatches: results,
  };

  await audit.logServiceCall(
    correlationId, 'A1', 'duplicate_check',
    { invoiceNumber, vendorId, amount, date, sourceType },
    { hasDuplicate, matchCount: results.length },
    Date.now() - start,
    hasDuplicate ? results[0].detail : null
  );

  return output;
}

module.exports = { check };
