// src/services/vendor/index.js — Vendor service
// Zoho: lookup by name + GSTIN via Zoho Books API
// CC: 4-step merchant matching against CC Merchant Map (sheet → Redis cache)
// Output conforms to VendorOutput contract

const Fuse = require('fuse.js');
const config = require('../../../config');
const cache = require('../../infra/cache/redis');
const audit = require('../audit-logger');

// ═══════════════════════════════════════════════════════════════
// MAIN ENTRY POINT — routes to Zoho or CC matching
// ═══════════════════════════════════════════════════════════════

async function lookup({ identifier, sourceType, gstin, correlationId }) {
  const start = Date.now();
  let result;

  if (sourceType === 'cc') {
    result = await matchCCMerchant(identifier, correlationId);
  } else {
    result = await lookupZohoVendor(identifier, gstin, correlationId);
  }

  await audit.logServiceCall(
    correlationId, sourceType === 'cc' ? 'A1' : 'A1',
    'vendor_lookup',
    { identifier, sourceType, gstin },
    result,
    Date.now() - start,
    result.matched ? null : 'No match found'
  );

  return result;
}

// ═══════════════════════════════════════════════════════════════
// ZOHO VENDOR LOOKUP — direct API call to Zoho Books
// ═══════════════════════════════════════════════════════════════

async function lookupZohoVendor(vendorName, gstin, correlationId) {
  // TODO: Agent 3 provides zoho-auth with valid access token
  // For now, return a structured lookup that can be wired to Zoho API
  try {
    const axios = require('axios');
    const token = config.zoho.accessToken;
    if (!token) {
      return buildOutput(false, null, vendorName, 'unknown', true, false, 'zoho_api', null,
        'Zoho access token not available — cannot lookup vendor');
    }

    // Search by GSTIN first (most accurate), fallback to name
    let searchParam = gstin ? `gst_no=${gstin}` : `contact_name=${encodeURIComponent(vendorName)}`;
    const resp = await axios.get(
      `${config.zoho.baseUrl}/contacts?organization_id=${config.zoho.orgId}&${searchParam}`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
    );

    const contacts = resp.data?.contacts || [];
    if (contacts.length === 0) {
      return buildOutput(false, null, vendorName, 'unknown', false, false, 'zoho_api', null,
        `No vendor found for ${gstin || vendorName}`);
    }

    const vendor = contacts[0];
    return buildOutput(
      true,
      vendor.contact_id,
      vendor.contact_name,
      vendor.gst_treatment || 'unknown',
      vendor.status === 'active',
      false, // is_bank determined by merchant map, not Zoho
      'zoho_api',
      null,
      null
    );
  } catch (err) {
    return buildOutput(false, null, vendorName, 'unknown', false, false, 'zoho_api', null,
      `Zoho API error: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// CC MERCHANT MATCHING — 4-step: exact → contains → fuzzy → Q3
// Reads from CC Merchant Map tab cached in Redis
// ═══════════════════════════════════════════════════════════════

async function matchCCMerchant(merchantString, correlationId) {
  const patterns = await cache.getMerchantMap();
  if (!patterns || patterns.length === 0) {
    return buildOutput(false, null, merchantString, 'unknown', false, false, 'none', null,
      'Merchant map not loaded — cache may be cold');
  }

  const merchant = merchantString.toLowerCase().trim();

  // ── Step 1: Exact match ──
  const exactMatch = patterns.find(p =>
    p.match_type === 'exact' && merchant === p.merchant_pattern.toLowerCase()
  );
  if (exactMatch) {
    return buildOutputFromPattern(exactMatch, 'exact');
  }

  // ── Step 2: Contains match (longest pattern wins) ──
  const containsMatches = patterns
    .filter(p => (p.match_type === 'contains' || !p.match_type) && p.merchant_pattern)
    .filter(p => merchant.includes(p.merchant_pattern.toLowerCase()))
    .sort((a, b) => b.merchant_pattern.length - a.merchant_pattern.length); // longest first

  if (containsMatches.length > 0) {
    return buildOutputFromPattern(containsMatches[0], 'contains');
  }

  // ── Step 3: Fuzzy match (suggest, never auto-confirm) ──
  if (config.fuzzy.enabled) {
    const suggestions = await fuzzyMatch(merchant, patterns);
    if (suggestions.length > 0) {
      const best = suggestions[0];
      return buildOutput(
        false, // NOT matched — fuzzy is suggestion only
        best.item.zoho_vendor_id,
        best.item.zoho_vendor_name,
        best.item.gst_treatment || 'unknown',
        true,
        best.item.is_bank === true || best.item.is_bank === 'yes',
        'fuzzy',
        suggestions.slice(0, config.fuzzy.maxSuggestions).map(s => ({
          name: s.item.zoho_vendor_name,
          pattern: s.item.merchant_pattern,
          score: Math.round((1 - s.score) * 100),
        })),
        `Fuzzy suggestion: ${best.item.zoho_vendor_name} (${Math.round((1 - best.score) * 100)}% confidence)`
      );
    }
  }

  // ── Step 4: No match → Q3 ──
  return buildOutput(false, null, merchantString, 'unknown', false, false, 'none', null,
    `No pattern match for "${merchantString}" — route to Q3 for Tushar`);
}

// ── Fuzzy matching using Fuse.js ──

async function fuzzyMatch(merchantLower, patterns) {
  // Also match against zoho_vendor_name for broader matching
  const searchList = patterns
    .filter(p => p.zoho_vendor_name)
    .map(p => ({ ...p, searchText: `${p.merchant_pattern} ${p.zoho_vendor_name}`.toLowerCase() }));

  const fuse = new Fuse(searchList, {
    keys: ['searchText', 'merchant_pattern', 'zoho_vendor_name'],
    threshold: 1 - config.fuzzy.threshold, // Fuse uses 0=perfect, 1=no match
    includeScore: true,
    minMatchCharLength: 3,
  });

  return fuse.search(merchantLower)
    .filter(r => (1 - r.score) >= config.fuzzy.threshold);
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function buildOutput(matched, vendorId, vendorName, gstTreatment, isActive, isBank, matchMethod, fuzzySuggestions, note) {
  return {
    matched,
    vendorId,
    vendorName,
    gstTreatment,
    isActive,
    isBank,
    matchMethod,
    fuzzySuggestions: fuzzySuggestions || null,
    note: note || null,
  };
}

function buildOutputFromPattern(pattern, method) {
  return buildOutput(
    true,
    pattern.zoho_vendor_id,
    pattern.zoho_vendor_name,
    pattern.gst_treatment || 'unknown',
    true,
    pattern.is_bank === true || pattern.is_bank === 'yes',
    method,
    null,
    pattern.gl_override ? `GL override: ${pattern.gl_override}` : null
  );
}

// ── Check if vendor is overseas using multiple signals (R08 mitigation) ──

function checkOverseasSignals(vendorResult, billData) {
  const signals = [];

  if (!vendorResult.vendorId) return { isOverseas: false, signals, confidence: 'unknown' };

  if (vendorResult.gstTreatment === 'overseas') signals.push('gst_treatment=overseas');
  if (!billData?.gstin && vendorResult.gstTreatment !== 'registered') signals.push('no_gstin');
  if (billData?.currency && billData.currency !== 'INR') signals.push('non_inr_currency');
  if (billData?.placeOfSupply === 'Overseas') signals.push('place_of_supply_overseas');

  const overseasCount = signals.length;
  const isOverseas = overseasCount > 0;

  // Confidence: if gst_treatment says registered but other signals say overseas → LOW confidence
  let confidence = 'high';
  if (isOverseas && vendorResult.gstTreatment === 'registered') {
    confidence = 'low'; // Conflict — flag for review
  }

  return { isOverseas, signals, confidence };
}

module.exports = { lookup, lookupZohoVendor, matchCCMerchant, checkOverseasSignals };
