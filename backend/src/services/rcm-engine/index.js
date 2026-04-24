// src/services/rcm-engine/index.js — Reverse Charge Mechanism engine
// R08 mitigation: 36/289 overseas bills missed RCM because system trusted gst_treatment alone.
// This service cross-checks MULTIPLE signals before deciding RCM.
// If any signal says overseas but gst_treatment says registered → confidence=low → Q1 flag.

const audit = require('../audit-logger');
const config = require('../../../config');

const IGST_18_TAX_ID = config.zohoIds.igst18TaxId; // 2295010000001409879

async function check({ vendorGstTreatment, isOverseas, vendorGstin, currency, vendorCountry, placeOfSupply, correlationId }) {
  const start = Date.now();

  // ── Gather all overseas signals ──
  const signals = [];
  let signalCount = 0;

  if (vendorGstTreatment === 'overseas') {
    signals.push({ signal: 'gst_treatment', value: 'overseas', overseas: true });
    signalCount++;
  } else {
    signals.push({ signal: 'gst_treatment', value: vendorGstTreatment, overseas: false });
  }

  if (!vendorGstin && vendorGstTreatment !== 'registered') {
    signals.push({ signal: 'no_gstin', value: 'missing', overseas: true });
    signalCount++;
  } else if (vendorGstin) {
    signals.push({ signal: 'gstin_present', value: vendorGstin.substring(0, 4) + '...', overseas: false });
  }

  if (currency && currency !== 'INR') {
    signals.push({ signal: 'currency', value: currency, overseas: true });
    signalCount++;
  } else if (currency) {
    signals.push({ signal: 'currency', value: 'INR', overseas: false });
  }

  if (vendorCountry && vendorCountry.toLowerCase() !== 'india' && vendorCountry.toLowerCase() !== 'in') {
    signals.push({ signal: 'country', value: vendorCountry, overseas: true });
    signalCount++;
  } else if (vendorCountry) {
    signals.push({ signal: 'country', value: vendorCountry, overseas: false });
  }

  if (placeOfSupply && placeOfSupply.toLowerCase() === 'overseas') {
    signals.push({ signal: 'place_of_supply', value: 'overseas', overseas: true });
    signalCount++;
  }

  // ── Decision logic ──
  const overseasSignals = signals.filter(s => s.overseas);
  const domesticSignals = signals.filter(s => !s.overseas);

  let rcmRequired = false;
  let confidence = 'high';
  let flagReason = null;

  if (signalCount === 0) {
    // All signals say domestic → no RCM
    rcmRequired = false;
    confidence = 'high';
  } else if (vendorGstTreatment === 'overseas' && signalCount >= 1) {
    // Treatment says overseas AND at least one other signal agrees → RCM
    rcmRequired = true;
    confidence = 'high';
  } else if (vendorGstTreatment !== 'overseas' && signalCount > 0) {
    // CONFLICT: treatment says NOT overseas but other signals say overseas
    // This is the exact scenario that caused 36/289 misses
    rcmRequired = false; // Don't auto-apply — but flag for review
    confidence = 'low';
    flagReason = `gst_treatment is "${vendorGstTreatment}" but ${signalCount} overseas signal(s) detected: ${overseasSignals.map(s => s.signal).join(', ')}. Manual review required — possible vendor master data error.`;
  } else if (isOverseas) {
    // Explicit overseas flag from caller
    rcmRequired = vendorGstTreatment === 'overseas';
    confidence = rcmRequired ? 'high' : 'low';
    if (!rcmRequired) {
      flagReason = `isOverseas=true but gst_treatment="${vendorGstTreatment}". Conflict — flag Q1.`;
    }
  }

  const result = {
    rcmRequired,
    taxType: rcmRequired ? 'IGST' : 'none',
    taxId: rcmRequired ? IGST_18_TAX_ID : null,
    taxRate: rcmRequired ? 18 : 0,
    confidence,
    signals: signals.map(s => `${s.signal}=${s.value}${s.overseas ? ' [OVERSEAS]' : ''}`),
    flagReason,
    needsQ1Review: confidence === 'low',
  };

  await audit.logServiceCall(
    correlationId, 'L4', 'rcm_check',
    { vendorGstTreatment, isOverseas, vendorGstin: vendorGstin?.substring(0, 4), currency, vendorCountry },
    { rcmRequired: result.rcmRequired, confidence: result.confidence, signalCount },
    Date.now() - start,
    result.needsQ1Review ? `LOW CONFIDENCE: ${flagReason}` : null
  );

  return result;
}

module.exports = { check };
