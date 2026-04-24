// src/rules/sheet-reader.js — Google Sheets API reader with version hash optimization
// Reads all 15 tabs from the V2 rules engine sheet + CC Merchant Map
// R05: version hash to reduce API quota usage
// R06: warm-on-start blocks until rules loaded
// R12: diff tracking on every refresh

const { google } = require('googleapis');
const config = require('../../config');
const cache = require('../infra/cache/redis');
const { query } = require('../infra/db/pool');
const crypto = require('crypto');

const RULE_TABS = [
  'GST Rules', 'TDS Rules', 'Vendor Rules', 'GL Mapping',
  'Amount Rules', 'Document Rules', 'Duplicate Rules',
  'Proof-Check Rules', 'Prepaid Rules', 'CC Pipeline Rules',
  'Master Validator',
];

const RULE_COLUMNS = [
  'rule_id', 'name', 'source_filter', 'executed_by', 'execution_order',
  'depends_on', 'condition_type', 'condition_value', 'severity',
  'score_penalty', 'on_fail_action', 'queue_bucket', 'notify_slack',
  'enabled', 'effective_from', 'effective_to', 'last_modified_by', 'notes',
];

const MERCHANT_COLUMNS = [
  'merchant_pattern', 'match_type', 'zoho_vendor_id', 'zoho_vendor_name',
  'gst_treatment', 'is_bank', 'gl_override', 'gl_rule', 'category',
  'added_by', 'added_date', 'status', 'fuzzy_confidence',
  'last_matched', 'match_count', 'notes',
];

let sheetsClient = null;

async function getSheetsClient() {
  if (!sheetsClient) {
    const keyJson = config.sheets.serviceAccountKey;
    if (!keyJson) {
      console.warn('[RULES] No Google Service Account key — using mock rules');
      return null;
    }
    const key = JSON.parse(keyJson);
    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    sheetsClient = google.sheets({ version: 'v4', auth });
  }
  return sheetsClient;
}

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((h, i) => {
    let val = row[i] || '';
    if (h === 'score_penalty' || h === 'execution_order') val = parseInt(val) || 0;
    if (h === 'enabled' || h === 'notify_slack') val = val.toLowerCase() === 'yes';
    if (h === 'is_bank') val = val.toLowerCase() === 'yes';
    obj[h] = val;
  });
  return obj;
}

// ── Read all rule tabs from Google Sheet ──

async function readAllRules() {
  const sheets = await getSheetsClient();
  if (!sheets) return null;

  const ranges = RULE_TABS.map(tab => `'${tab}'!A1:R200`);
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: config.sheets.rulesSheetId,
    ranges,
  });

  const rulesByTab = {};
  response.data.valueRanges.forEach((range, idx) => {
    const tabName = RULE_TABS[idx];
    const rows = range.values || [];
    if (rows.length < 2) { rulesByTab[tabName] = []; return; }

    const headers = rows[0].map(h => h.trim().toLowerCase().replace(/[★\s]+/g, ''));
    const rules = rows.slice(1)
      .map(row => rowToObject(headers.length > 0 ? headers : RULE_COLUMNS, row))
      .filter(r => r.rule_id && r.enabled !== false && !r.name?.includes('RETIRED'));

    rulesByTab[tabName] = rules;
  });

  return rulesByTab;
}

// ── Read CC Merchant Map tab ──

async function readMerchantMap() {
  const sheets = await getSheetsClient();
  if (!sheets) return null;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.rulesSheetId,
    range: `'${config.sheets.merchantMapTab}'!A1:P200`,
  });

  const rows = response.data.values || [];
  if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return rows.slice(1)
    .map(row => rowToObject(headers.length > 0 ? headers : MERCHANT_COLUMNS, row))
    .filter(p => p.merchant_pattern && p.status === 'confirmed');
}

// ── Compute version hash of all rules ──

function computeVersionHash(rulesByTab) {
  const data = JSON.stringify(rulesByTab);
  return crypto.createHash('md5').update(data).digest('hex');
}

// ── Diff detection (R12 mitigation) ──

async function detectChanges(oldRules, newRules) {
  const changes = [];
  const criticalFields = ['score_penalty', 'condition_value', 'severity', 'on_fail_action', 'enabled'];

  for (const [tab, newTabRules] of Object.entries(newRules)) {
    const oldTabRules = oldRules?.[tab] || [];
    const oldMap = Object.fromEntries(oldTabRules.map(r => [r.rule_id, r]));

    for (const newRule of newTabRules) {
      const oldRule = oldMap[newRule.rule_id];
      if (!oldRule) {
        changes.push({ rule_id: newRule.rule_id, tab, field: '_new_rule', old: null, new: newRule.name, critical: true });
        continue;
      }
      for (const field of criticalFields) {
        if (String(oldRule[field]) !== String(newRule[field])) {
          changes.push({
            rule_id: newRule.rule_id, tab, field,
            old: oldRule[field], new: newRule[field],
            critical: criticalFields.includes(field),
          });
        }
      }
    }
  }
  return changes;
}

async function logChanges(changes, version) {
  if (changes.length === 0) return;
  for (const change of changes) {
    await query(
      `INSERT INTO rule_change_log (rule_id, field_changed, old_value, new_value, is_critical, rules_version)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [change.rule_id, change.field, String(change.old), String(change.new), change.critical, version]
    );
  }
  console.log(`[RULES] ${changes.length} rule changes detected (${changes.filter(c => c.critical).length} critical)`);
}

// ── Main refresh function ──

async function refreshRules() {
  const startTime = Date.now();
  console.log('[RULES] Refreshing rules from Google Sheet...');

  try {
    // Read new rules
    const newRules = await readAllRules();
    if (!newRules) {
      console.warn('[RULES] Could not read rules — keeping cached version');
      return { refreshed: false, reason: 'read_failed' };
    }
    const newVersion = computeVersionHash(newRules);

    // Check if version changed (R05: avoid unnecessary full reads)
    const oldVersion = await cache.getRulesVersion();
    if (oldVersion === newVersion) {
      console.log('[RULES] No changes detected (version hash match)');
      // Still update last_refresh timestamp
      await cache.getClient().set('rules:_last_refresh', new Date().toISOString());
      return { refreshed: false, reason: 'no_changes', version: newVersion };
    }

    // Detect changes (R12)
    const oldRules = {};
    for (const tab of RULE_TABS) {
      oldRules[tab] = await cache.getRules(tab) || [];
    }
    const changes = await detectChanges(oldRules, newRules);
    await logChanges(changes, newVersion);

    // Update cache
    await cache.setAllRules(newRules, newVersion);

    // Also refresh merchant map
    const merchantMap = await readMerchantMap();
    if (merchantMap) {
      await cache.setMerchantMap(merchantMap);
      console.log(`[RULES] Merchant map: ${merchantMap.length} confirmed patterns cached`);
    }

    const totalRules = Object.values(newRules).reduce((sum, tab) => sum + tab.length, 0);
    const duration = Date.now() - startTime;
    console.log(`[RULES] Refreshed: ${totalRules} rules across ${RULE_TABS.length} tabs in ${duration}ms (version: ${newVersion.substring(0, 8)})`);

    return {
      refreshed: true,
      totalRules,
      version: newVersion,
      changes: changes.length,
      criticalChanges: changes.filter(c => c.critical).length,
      duration,
    };
  } catch (err) {
    console.error('[RULES] Refresh failed:', err.message);
    return { refreshed: false, reason: 'error', error: err.message };
  }
}

// ── Warm-on-start: block until rules are loaded (R06) ──

async function warmOnStart() {
  const warm = await cache.isCacheWarm();
  if (warm) {
    console.log('[RULES] Cache is warm — using cached rules');
    return;
  }
  console.log('[RULES] Cache is COLD — must load rules before processing any bills');
  const result = await refreshRules();
  if (!result.refreshed && result.reason !== 'no_changes') {
    console.error('[RULES] CRITICAL: Could not load rules on startup. System cannot process bills.');
    throw new Error('Rules cache warm-on-start failed');
  }
  console.log('[RULES] Cache warmed successfully');
}

module.exports = {
  readAllRules, readMerchantMap, refreshRules, warmOnStart,
  computeVersionHash, detectChanges, RULE_TABS,
};
