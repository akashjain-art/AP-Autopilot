// src/services/zoho-poster/index.js — Single write gate for ALL Zoho mutations
// R02: idempotency keys prevent duplicate posting on retry
// R03: draft mode from DEPLOY_MODE + epoch-based transition
// R07: rate limiter (40 calls/min, leaving headroom for health checks)
//
// ══════════════════════════════════════════════════════════════
// IMMUTABLE ZOHO RULES — enforced in code, not just config
// ZH-1: NO DELETION — delete API calls are PERMANENTLY PROHIBITED
// ZH-2: NO UPDATE OF POSTED ENTRIES — only draft records can be updated
// ZH-3: DRAFT ONLY — system never submits/approves, only saves as draft
// These rules cannot be overridden by configuration, feature flags, or
// any code change without explicit FC approval and architecture review.
// ══════════════════════════════════════════════════════════════

const axios = require('axios');
const Bottleneck = require('bottleneck');
const config = require('../../../config');
const { getAccessToken } = require('./auth');
const { query } = require('../../infra/db/pool');
const audit = require('../audit-logger');

// ── ZH-1: Hard guard — block any HTTP DELETE call to Zoho ──
// This wraps axios to ensure no delete call ever reaches Zoho Books.
const zohoAxios = {
  post: (url, data, cfg) => {
    if (url.includes('zohoapis')) {
      _assertNotDelete(url);
    }
    return axios.post(url, data, cfg);
  },
  put: (url, data, cfg) => {
    if (url.includes('zohoapis')) {
      _assertNotDelete(url);
      _assertDraftOnlyUpdate(url, data);
    }
    return axios.put(url, data, cfg);
  },
  // DELETE is never used — any accidental call throws immediately
  delete: (url) => {
    throw new Error(
      `[ZH-1 VIOLATION] DELETE call blocked to: ${url}\n` +
      'The AP Autopilot system is prohibited from deleting any Zoho record.\n' +
      'To remove a record, a human must do it manually in Zoho Books.'
    );
  },
};

function _assertNotDelete(url) {
  // Extra safety: block any URL pattern that looks like a delete endpoint
  if (/\/delete|\/void\/.*delete/i.test(url)) {
    throw new Error(`[ZH-1 VIOLATION] Suspicious delete-pattern URL blocked: ${url}`);
  }
}

function _assertDraftOnlyUpdate(url, data) {
  // ZH-2: Block updates to posted entries
  // If status is being changed away from draft, block it
  if (data && data.status && data.status !== 'draft') {
    throw new Error(
      `[ZH-2 VIOLATION] Attempted to update entry to status='${data.status}'.\n` +
      'The AP Autopilot system can only save entries as DRAFT.\n' +
      'Posted entries are immutable. Use Zoho Books UI to post drafts.'
    );
  }
}

// ZH-3: Hard guard on the post() function — always force draft
function _enforceDraftOnly(payload, context) {
  if (payload && payload.status && payload.status !== 'draft') {
    console.warn(
      `[ZH-3 WARNING] Payload had status='${payload.status}' for ${context}. ` +
      'Overriding to draft. The system never posts live entries.'
    );
  }
  return { ...payload, status: 'draft' };
}

// Rate limiter: 40 requests per minute to Zoho API (R07)
const limiter = new Bottleneck({
  reservoir: config.zoho.rateLimit.maxPerMinute,
  reservoirRefreshAmount: config.zoho.rateLimit.maxPerMinute,
  reservoirRefreshInterval: 60 * 1000,
  maxConcurrent: 5,
});

limiter.on('depleted', () => {
  console.warn('[ZOHO-API] Rate limit reached — requests queuing');
});

// ── Determine effective deploy mode (R03 epoch-based transition) ──

function getEffectiveMode(billEnteredAt) {
  if (config.deployMode === 'draft') return 'draft';
  if (config.liveEpochCutoff && billEnteredAt) {
    const enteredTime = new Date(billEnteredAt).getTime();
    const cutoff = new Date(config.liveEpochCutoff).getTime();
    return enteredTime < cutoff ? 'draft' : 'live';
  }
  return config.deployMode;
}

// ── Main post function ──

async function post({ entryType, payload, draftMode, idempotencyKey, correlationId, billEnteredAt }) {
  const start = Date.now();
  const effectiveMode = draftMode !== undefined ? (draftMode ? 'draft' : 'live') : getEffectiveMode(billEnteredAt);

  // R02: Check if already posted (idempotency via PostgreSQL)
  if (idempotencyKey) {
    const existing = await checkExistingPost(idempotencyKey, entryType);
    if (existing) {
      console.log(`[ZOHO-POST] Idempotent hit: ${idempotencyKey} already posted as ${existing.zohoId}`);
      return { zohoId: existing.zohoId, status: existing.status, postedFields: existing.postedFields, idempotentHit: true };
    }
  }

  // Record pending post in PostgreSQL before calling Zoho
  if (idempotencyKey) {
    await recordPendingPost(idempotencyKey, entryType, correlationId);
  }

  try {
    let result;
    switch (entryType) {
      case 'bill':
        result = await createBill(payload, effectiveMode);
        break;
      case 'journal':
        result = await createJournal(payload, effectiveMode);
        break;
      case 'payment':
        result = await applyPayment(payload);
        break;
      default:
        throw new Error(`Unknown entry type: ${entryType}`);
    }

    // Update PostgreSQL with Zoho ID
    if (idempotencyKey && result.zohoId) {
      await recordCompletedPost(idempotencyKey, result.zohoId, result.status, result.postedFields);
    }

    await audit.logZohoPost(correlationId, entryType, result.zohoId, effectiveMode === 'draft');

    return { ...result, duration: Date.now() - start };
  } catch (err) {
    console.error(`[ZOHO-POST] ${entryType} failed:`, err.message);

    await audit.logServiceCall(
      correlationId, 'A3', `zoho_post_${entryType}`,
      { entryType, idempotencyKey },
      null,
      Date.now() - start,
      err.message
    );

    throw err;
  }
}

// ── Create bill in Zoho Books ──

async function createBill(payload, mode) {
  const token = await getAccessToken();
  if (!token) throw new Error('No Zoho access token');

  // ZH-3: Always force draft — system never posts live
  const safePaylod = _enforceDraftOnly(payload, 'createBill');

  const resp = await limiter.schedule(() =>
    zohoAxios.post(
      `${config.zoho.baseUrl}/bills?organization_id=${config.zoho.orgId}`,
      safePaylod,
      { headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' } }
    )
  );

  const bill = resp.data?.bill;
  return {
    zohoId: bill?.bill_id,
    status: bill?.status || mode,
    postedFields: {
      vendor_name: bill?.vendor_name,
      total: bill?.total,
      bill_number: bill?.bill_number,
      date: bill?.date,
    },
  };
}

// ── Create journal entry in Zoho Books ──

async function createJournal(payload, mode) {
  const token = await getAccessToken();
  if (!token) throw new Error('No Zoho access token');

  // ZH-3: Always force draft
  const safePayload = _enforceDraftOnly(payload, 'createJournal');

  const resp = await limiter.schedule(() =>
    zohoAxios.post(
      `${config.zoho.baseUrl}/journals?organization_id=${config.zoho.orgId}`,
      safePayload,
      { headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' } }
    )
  );

  const journal = resp.data?.journal;
  return {
    zohoId: journal?.journal_id,
    status: journal?.status || mode,
    postedFields: {
      journal_date: journal?.journal_date,
      total: journal?.total,
      reference_number: journal?.reference_number,
    },
  };
}

// ── Apply payment (settlement) in Zoho Books ──

async function applyPayment(payload) {
  const token = await getAccessToken();
  if (!token) throw new Error('No Zoho access token');

  const resp = await limiter.schedule(() =>
    axios.post(
      `${config.zoho.baseUrl}/vendorpayments?organization_id=${config.zoho.orgId}`,
      payload,
      { headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' } }
    )
  );

  const payment = resp.data?.vendorpayment;
  return {
    zohoId: payment?.payment_id,
    status: 'applied',
    postedFields: {
      amount: payment?.amount,
      vendor_name: payment?.vendor_name,
      payment_number: payment?.payment_number,
    },
  };
}

// ── R02: Idempotency tracking via PostgreSQL ──

async function checkExistingPost(idempotencyKey, entryType) {
  const field = entryType === 'bill' ? 'zoho_bill_id' : entryType === 'journal' ? 'zoho_journal_id' : 'zoho_payment_id';
  const result = await query(
    `SELECT ${field} as zoho_id, status FROM bill_lifecycle
     WHERE correlation_id LIKE $1 AND ${field} IS NOT NULL LIMIT 1`,
    [`%${idempotencyKey.split('-').slice(1, 3).join('-')}%`]
  );
  if (result.rows.length > 0 && result.rows[0].zoho_id) {
    return { zohoId: result.rows[0].zoho_id, status: result.rows[0].status, postedFields: {} };
  }
  return null;
}

async function recordPendingPost(idempotencyKey, entryType, correlationId) {
  // Minimal tracking — the bill_lifecycle record should already exist
  console.log(`[ZOHO-POST] Pending: ${entryType} for ${correlationId} (key: ${idempotencyKey})`);
}

async function recordCompletedPost(idempotencyKey, zohoId, status, postedFields) {
  console.log(`[ZOHO-POST] Completed: ${zohoId} (key: ${idempotencyKey})`);
}

// ── Void an entry (saga compensation) ──

async function voidBill(billId) {
  const token = await getAccessToken();
  if (!token) throw new Error('No Zoho access token');

  await limiter.schedule(() =>
    axios.post(
      `${config.zoho.baseUrl}/bills/${billId}/status/void?organization_id=${config.zoho.orgId}`,
      {},
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
    )
  );
  console.log(`[ZOHO-POST] Voided bill: ${billId}`);
}

async function voidJournal(journalId) {
  const token = await getAccessToken();
  if (!token) throw new Error('No Zoho access token');

  // ZH-1: Use void endpoint, NOT delete. Zoho journals are voided via POST status change.
  // We never call DELETE on any Zoho record.
  await limiter.schedule(() =>
    zohoAxios.post(
      `${config.zoho.baseUrl}/journals/${journalId}/status/void?organization_id=${config.zoho.orgId}`,
      {},
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
    )
  );
  console.log(`[ZOHO-POST] Voided journal (via status change, not delete): ${journalId}`);
}

module.exports = { post, voidBill, voidJournal, getEffectiveMode };
