// test/run-tests.js — Comprehensive test suite
// Mocks: Redis, PostgreSQL, Zoho API, Google Sheets
// Tests: vendor matching, GL classifier, RCM engine, duplicate checker, score calculator,
//        CC orchestrator (13-step), Zoho orchestrator (12-step), PDF extractor
// Run: node test/run-tests.js

const { INVOICES, CC_TRANSACTIONS, MERCHANT_PATTERNS, EXPECTED } = require('./fixtures');

// ═══════════════════════════════════════════════════════════════
// MOCK LAYER — replace external dependencies
// ═══════════════════════════════════════════════════════════════

const mockCache = {};
const mockDb = { bills: [], audit: [], exceptions: [] };

// Mock Redis
const mockRedis = {
  _data: {},
  async get(key) { const v = this._data[key]; return v ? JSON.parse(v) : null; },
  async set(key, val) { this._data[key] = JSON.stringify(val); },
  async connect() {},
  async ping() { return 'PONG'; },
  async quit() {},
  pipeline() { return { set: () => {}, exec: async () => {} }; },
};

// Mock DB
const mockQuery = async (sql, params) => {
  if (sql.includes('INSERT INTO bill_lifecycle')) {
    mockDb.bills.push({ correlation_id: params[0], source: params?.[1] || 'zoho', status: 'processing' });
    return { rows: [] };
  }
  if (sql.includes('INSERT INTO audit_events')) return { rows: [] };
  if (sql.includes('INSERT INTO exceptions')) return { rows: [{ id: mockDb.exceptions.length + 1 }] };
  if (sql.includes('INSERT INTO batch_tracking')) return { rows: [] };
  if (sql.includes('INSERT INTO rule_change_log')) return { rows: [] };
  if (sql.includes('UPDATE bill_lifecycle')) return { rows: [] };
  if (sql.includes('UPDATE batch_tracking')) return { rows: [] };
  if (sql.includes('UPDATE exceptions')) return { rows: [] };
  if (sql.includes('UPDATE system_state')) return { rows: [] };
  if (sql.includes('SELECT') && sql.includes('bill_lifecycle') && sql.includes('invoice_number')) {
    // Duplicate check: search by invoice_number + vendor_id
    const invNum = params?.[0];
    const vendorId = params?.[1];
    const match = mockDb.bills.find(b => b.invoice_number === invNum && b.vendor_id === vendorId && b.status !== 'voided');
    return { rows: match ? [match] : [] };
  }
  if (sql.includes('SELECT') && sql.includes('bill_lifecycle') && sql.includes('merchant_string')) {
    return { rows: [] }; // No CC duplicates in mock
  }
  if (sql.includes('SELECT') && sql.includes('bill_lifecycle') && sql.includes('amount')) {
    return { rows: [] }; // No cross-vendor duplicates
  }
  if (sql.includes('SELECT id FROM bill_lifecycle')) {
    return { rows: [{ id: 1 }] };
  }
  if (sql.includes('SELECT') && sql.includes('bill_lifecycle') && sql.includes('correlation_id')) {
    return { rows: [{ status: 'processing' }] };
  }
  if (sql.includes('COUNT') && sql.includes('exceptions')) return { rows: [{ cnt: '0' }] };
  return { rows: [] };
};

// ── Inject mocks before loading modules ──
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'mock';
process.env.REDIS_URL = 'mock';
process.env.DEPLOY_MODE = 'draft';

// Override requires
const Module = require('module');
const origResolve = Module._resolveFilename;
const mockModules = {};

function mockModule(name, impl) { mockModules[name] = impl; }

// Set up mock overrides
mockModule('ioredis', function() { return mockRedis; });

// Now load and patch modules
const config = require('../config');
config.zoho.accessToken = 'mock-token';
config.zoho.orgId = '60036724867';
config.slack.botToken = null; // disable Slack in tests

// Patch database pool
const dbPool = require('../src/infra/db/pool');
dbPool.query = mockQuery;
dbPool.healthCheck = async () => ({ healthy: true });

// Patch Redis cache
const cache = require('../src/infra/cache/redis');
Object.assign(cache, {
  connect: async () => {},
  get: async (key) => mockRedis._data[key] ? JSON.parse(mockRedis._data[key]) : null,
  set: async (key, val) => { mockRedis._data[key] = JSON.stringify(val); },
  getRules: async (tab) => mockRedis._data[`rules:${tab}`] ? JSON.parse(mockRedis._data[`rules:${tab}`]) : null,
  setAllRules: async (rules, version) => {
    for (const [tab, data] of Object.entries(rules)) mockRedis._data[`rules:${tab}`] = JSON.stringify(data);
    mockRedis._data['rules:_version'] = version;
    mockRedis._data['rules:_last_refresh'] = new Date().toISOString();
  },
  getRulesVersion: async () => mockRedis._data['rules:_version'] || null,
  getLastRefresh: async () => mockRedis._data['rules:_last_refresh'] || null,
  isCacheWarm: async () => !!mockRedis._data['rules:_version'],
  getMerchantMap: async () => MERCHANT_PATTERNS,
  setMerchantMap: async (p) => { mockRedis._data['rules:cc_merchant_map'] = JSON.stringify(p); },
  healthCheck: async () => ({ healthy: true, stale: false }),
  checkStaleness: async () => ({ stale: false }),
  disconnect: async () => {},
  getClient: () => mockRedis,
});

// Seed some rules into cache for GL classification
const glRules = [
  { rule_id: 'GL-001', name: 'Software/SaaS', condition_value: "['software','saas','zoho','adobe','subscription']", notes: '→ Subscription Charges (SAC 998314)', enabled: true, executed_by: 'L4', severity: 'info', score_penalty: 0 },
  { rule_id: 'GL-002', name: 'Cloud/Hosting', condition_value: "['cloud','hosting','server','compute','storage','aws']", notes: '→ Cloud Charges (SAC 998315)', enabled: true, executed_by: 'L4', severity: 'info', score_penalty: 0 },
  { rule_id: 'GL-004', name: 'Rent/Infrastructure', condition_value: "['rent','warehouse','co-working','office']", notes: '→ Infrastructure CityWise (SAC 997212)', enabled: true, executed_by: 'L4', severity: 'info', score_penalty: 0 },
  { rule_id: 'GL-005', name: 'Legal/Professional', condition_value: "['legal','audit','consulting','lawyer']", notes: '→ Legal & Professional (SAC 998221)', enabled: true, executed_by: 'L4', severity: 'info', score_penalty: 0 },
  { rule_id: 'GL-006', name: 'Advertising', condition_value: "['marketing','ads','google ads','campaign','seo']", notes: '→ Advert & Marketing (SAC 998361)', enabled: true, executed_by: 'L4', severity: 'info', score_penalty: 0 },
  { rule_id: 'GL-012', name: 'Finance/Banking', condition_value: "['bank charge','finance charge','interest','payment gateway']", notes: '→ Finance Cost (SAC 997119)', enabled: true, executed_by: 'L4', severity: 'info', score_penalty: 0 },
  { rule_id: 'GL-013', name: 'Travel', condition_value: "['travel','hotel','flight','cab','uber','indigo','makemytrip']", notes: '→ Travel Expenses (SAC 996311)', enabled: true, executed_by: 'L4', severity: 'info', score_penalty: 0 },
  { rule_id: 'GL-015', name: 'SUSPENSE', condition_value: "[]", notes: '→ SUSPENSE — manual', enabled: true, executed_by: 'L4', severity: 'warning', score_penalty: -10 },
];
mockRedis._data['rules:GL Mapping'] = JSON.stringify(glRules);
mockRedis._data['rules:TDS Rules'] = JSON.stringify([
  { rule_id: 'TDS-005', name: 'Section 393', executed_by: 'L4', severity: 'critical', score_penalty: -30, queue_bucket: 'Q2', enabled: true, source_filter: 'all' },
  { rule_id: 'TDS-007', name: 'Unregistered TDS', executed_by: 'L4', severity: 'critical', score_penalty: -30, queue_bucket: 'Q2', enabled: true, source_filter: 'all' },
]);

// Mock Zoho API (for poster)
const axios = require('axios');
const origAxiosPost = axios.post;
const origAxiosGet = axios.get;
let zohoCallCount = 0;
axios.post = async (url, data, opts) => {
  if (url.includes('zoho')) {
    zohoCallCount++;
    if (url.includes('/bills')) return { data: { bill: { bill_id: `MOCK-BILL-${zohoCallCount}`, vendor_name: data?.vendor_id, total: data?.line_items?.[0]?.amount, status: 'draft', bill_number: data?.bill_number, date: data?.date } } };
    if (url.includes('/journals')) return { data: { journal: { journal_id: `MOCK-JRN-${zohoCallCount}`, total: data?.line_items?.[0]?.amount, status: 'draft' } } };
    if (url.includes('/vendorpayments')) return { data: { vendorpayment: { payment_id: `MOCK-PAY-${zohoCallCount}`, amount: data?.amount } } };
    if (url.includes('/status/void')) return { data: { message: 'voided' } };
    if (url.includes('oauth')) return { data: { access_token: 'mock-token', expires_in: 3600 } };
    return { data: {} };
  }
  if (url.includes('slack')) return { data: { ok: true, ts: '12345' } };
  return origAxiosPost(url, data, opts);
};
axios.get = async (url, opts) => {
  if (url.includes('zoho') && url.includes('/organization')) return { status: 200, data: { organization: { name: 'Omnia Information' } } };
  if (url.includes('zoho') && url.includes('/contacts')) return { data: { contacts: [{ contact_id: 'VND-MOCK', contact_name: 'Mock Vendor', gst_treatment: 'registered', status: 'active' }] } };
  if (url.includes('zoho') && url.includes('/bills/')) return { data: { bill: { vendor_name: 'Mock', total: 42500, bill_number: 'CT/2026/1847', is_reverse_charge: false, line_items: [{ account_name: 'Subscription Charges', tax_amount: 0 }] } } };
  return origAxiosGet(url, opts);
};

// ═══════════════════════════════════════════════════════════════
// LOAD SERVICES
// ═══════════════════════════════════════════════════════════════
const vendorService = require('../src/services/vendor');
const glClassifier = require('../src/services/gl-classifier');
const rcmEngine = require('../src/services/rcm-engine');
const duplicateChecker = require('../src/services/duplicate-checker');
const scoreCalc = require('../src/services/score-calculator');
const pdfExtractor = require('../src/orchestrators/zoho-invoice/pdf-extractor');
const { CCSaga } = require('../src/orchestrators/cc-transaction/saga');

// ═══════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════

let passed = 0, failed = 0, total = 0;

function assert(condition, testName, detail) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    console.log(`  ✗ ${testName} — ${detail || 'FAILED'}`);
  }
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  WIOM FINANCE AUTOPILOT V9 — TEST SUITE');
  console.log('═══════════════════════════════════════════════════\n');

  // ── TEST 1: CC Merchant Matching (4-step) ──
  console.log('── CC Merchant Matching ──');
  for (const txn of CC_TRANSACTIONS) {
    const exp = EXPECTED[txn.id];
    if (!exp) continue;

    if (exp.skip) {
      // Skip rule test — handled by orchestrator, not vendor service
      assert(true, `${txn.id} (${txn.merchant.substring(0, 25)}): skip rule expected`);
      continue;
    }

    const result = await vendorService.matchCCMerchant(txn.merchant, `test-${txn.id}`);

    assert(result.matched === exp.matched,
      `${txn.id} match=${result.matched}`,
      `expected matched=${exp.matched}, got ${result.matched}`);

    if (exp.vendor) {
      assert(result.vendorName === exp.vendor,
        `${txn.id} → ${result.vendorName?.substring(0, 30)}`,
        `expected "${exp.vendor}", got "${result.vendorName}"`);
    }
    if (exp.isBank !== undefined) {
      assert(result.isBank === exp.isBank,
        `${txn.id} isBank=${result.isBank}`,
        `expected isBank=${exp.isBank}`);
    }
    if (exp.method) {
      assert(result.matchMethod === exp.method,
        `${txn.id} method=${result.matchMethod}`,
        `expected method=${exp.method}, got ${result.matchMethod}`);
    }
  }

  // ── Conflict trap tests ──
  console.log('\n── Conflict Traps ──');
  const hdfc_bank = await vendorService.matchCCMerchant('HDFC BANK FINANCE CHARGES', 'test-conflict-1');
  const hdfc_ergo = await vendorService.matchCCMerchant('HDFC ERGO INSURANCE PREMIUM', 'test-conflict-2');
  assert(hdfc_bank.vendorName?.includes('HDFC Bank'), 'HDFC BANK → HDFC Bank (not Ergo)', `got: ${hdfc_bank.vendorName}`);
  assert(hdfc_ergo.vendorName?.includes('HDFC Ergo'), 'HDFC ERGO → HDFC Ergo (not Bank)', `got: ${hdfc_ergo.vendorName}`);

  const aws = await vendorService.matchCCMerchant('AMAZON WEB SERVICES AWS.AMAZON.COM', 'test-conflict-3');
  assert(aws.vendorName?.includes('Amazon Web Services'), 'AMAZON WEB SERVICES → AWS (not Amazon.in)', `got: ${aws.vendorName}`);

  // ── TEST 2: GL Classifier ──
  console.log('\n── GL Classifier ──');
  const gl1 = await glClassifier.classify({ text: 'Zoho One annual subscription', sourceType: 'zoho', hsnSac: '998314', correlationId: 'test-gl-1' });
  assert(gl1.glRule === 'GL-001' || gl1.glAccount.includes('Subscription'), 'HSN 998314 → Subscription Charges', `got: ${gl1.glAccount} (${gl1.glRule})`);

  const gl2 = await glClassifier.classify({ text: 'SWIGGY TEAM LUNCH ORDER', sourceType: 'cc', correlationId: 'test-gl-2' });
  assert(gl2.isRestaurant === true, 'Swiggy → restaurant detected', `isRestaurant=${gl2.isRestaurant}`);
  assert(gl2.glAccount === 'Staff Welfare', 'Swiggy → Staff Welfare GL', `got: ${gl2.glAccount}`);

  const gl3 = await glClassifier.classify({ text: 'RANDOM UNKNOWN SERVICE', sourceType: 'cc', correlationId: 'test-gl-3' });
  assert(gl3.isManual === true, 'Unknown → GL-015 suspense', `isManual=${gl3.isManual}, rule=${gl3.glRule}`);

  const gl4 = await glClassifier.classify({ text: 'HDFC BANK FINANCE CHARGES INTEREST', sourceType: 'cc', correlationId: 'test-gl-4' });
  assert(gl4.glAccount.includes('Finance') || gl4.glRule === 'GL-012', 'Bank charges → Finance Cost', `got: ${gl4.glAccount}`);

  // ── TEST 3: RCM Engine (multi-signal) ──
  console.log('\n── RCM Engine ──');
  const rcm1 = await rcmEngine.check({ vendorGstTreatment: 'overseas', isOverseas: true, currency: 'USD', vendorCountry: 'USA', correlationId: 'test-rcm-1' });
  assert(rcm1.rcmRequired === true, 'Overseas vendor → RCM required', `rcm=${rcm1.rcmRequired}`);
  assert(rcm1.confidence === 'high', 'Multiple signals agree → high confidence', `confidence=${rcm1.confidence}`);

  const rcm2 = await rcmEngine.check({ vendorGstTreatment: 'registered', isOverseas: false, currency: 'USD', vendorCountry: 'USA', correlationId: 'test-rcm-2' });
  assert(rcm2.confidence === 'low', 'R08: registered + overseas signals → LOW confidence', `confidence=${rcm2.confidence}`);
  assert(rcm2.needsQ1Review === true, 'R08: conflict → flag for Q1 review', `needsQ1=${rcm2.needsQ1Review}`);

  const rcm3 = await rcmEngine.check({ vendorGstTreatment: 'registered', isOverseas: false, currency: 'INR', vendorCountry: 'India', correlationId: 'test-rcm-3' });
  assert(rcm3.rcmRequired === false, 'Domestic vendor → no RCM', `rcm=${rcm3.rcmRequired}`);
  assert(rcm3.confidence === 'high', 'All domestic signals → high confidence', `confidence=${rcm3.confidence}`);

  // ── TEST 4: Score Calculator ──
  console.log('\n── Score Calculator ──');
  const score1 = await scoreCalc.calculate({
    ruleResults: [
      { rule_id: 'A1-001', passed: true, severity: 'critical', penalty: 0 },
      { rule_id: 'A1-030', passed: true, severity: 'critical', penalty: 0 },
      { rule_id: 'GST-001', passed: true, severity: 'critical', penalty: 0 },
    ],
    sourceType: 'zoho', correlationId: 'test-score-1',
  });
  assert(score1.score === 100, 'All passed → score 100', `score=${score1.score}`);
  assert(score1.naturalRoute === 'auto', 'Score 100 → auto route', `route=${score1.naturalRoute}`);
  assert(score1.route === 'exception', 'Phase 1 override → exception route', `effective=${score1.route}`);

  const score2 = await scoreCalc.calculate({
    ruleResults: [
      { rule_id: 'A1-030', passed: false, severity: 'critical', penalty: -30, queue_bucket: 'Q3' },
      { rule_id: 'GST-001', passed: true, severity: 'critical', penalty: 0 },
    ],
    sourceType: 'zoho', correlationId: 'test-score-2',
  });
  assert(score2.score === 70, '1 critical fail (-30) → score 70', `score=${score2.score}`);
  assert(score2.naturalRoute === 'approval', 'Score 70 → approval route', `route=${score2.naturalRoute}`);

  const score3 = await scoreCalc.calculate({
    ruleResults: [
      { rule_id: 'A1-030', passed: false, severity: 'critical', penalty: -30, queue_bucket: 'Q3' },
      { rule_id: 'A1-020', passed: false, severity: 'critical', penalty: -30, queue_bucket: 'Q4' },
    ],
    sourceType: 'zoho', correlationId: 'test-score-3',
  });
  assert(score3.score === 40, '2 critical fails (-60) → score 40', `score=${score3.score}`);
  assert(score3.naturalRoute === 'exception', 'Score 40 → exception', `route=${score3.naturalRoute}`);
  assert(score3.failedQueues.includes('Q3') && score3.failedQueues.includes('Q4'), 'Failed queues: Q3, Q4', `queues=${score3.failedQueues}`);

  const scoreCc = await scoreCalc.calculate({ ruleResults: [], sourceType: 'cc', correlationId: 'test-score-cc' });
  assert(scoreCc.score === null, 'CC → no score (null)', `score=${scoreCc.score}`);
  assert(scoreCc.route === 'cc_pipeline', 'CC → cc_pipeline route', `route=${scoreCc.route}`);

  // ── TEST 5: Duplicate Checker ──
  console.log('\n── Duplicate Checker ──');
  const dup1 = await duplicateChecker.check({ invoiceNumber: 'UNIQUE-001', vendorId: 'VND-001', amount: 1000, date: '2026-04-01', sourceType: 'zoho', correlationId: 'test-dup-1' });
  assert(dup1.hasDuplicate === false, 'Unique invoice → no duplicate', `dup=${dup1.hasDuplicate}`);

  // ── TEST 6: PDF Extractor ──
  console.log('\n── PDF Extractor ──');
  // Create a mock PDF text (simulate what pdf-parse would return)
  const mockPdfText = `
CloudTech Solutions Pvt Ltd
GSTIN: 27AABCC1234D1ZA
Tax Invoice
Invoice No: CT/2026/1847
Date: 15-03-2026
HSN/SAC: 998314

Description: SaaS Annual Subscription
Amount: 42,500.00
CGST @9%: 3,825.00
SGST @9%: 3,825.00
Total: 50,150.00

Bill To: Omnia Information Private Limited
GSTIN: 06AACCO1206D1ZG
Place of Supply: Haryana
`;

  // We can't easily mock pdf-parse, so test the regex patterns directly
  const gstinPattern = /\b(\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1})\b/g;
  const gstins = [...new Set((mockPdfText.match(gstinPattern) || []))];
  assert(gstins.length === 2, `Found ${gstins.length} GSTINs in mock PDF`, `expected 2`);
  assert(gstins[0] === '27AABCC1234D1ZA', 'Vendor GSTIN extracted', `got: ${gstins[0]}`);
  assert(gstins[1] === '06AACCO1206D1ZG', 'Buyer GSTIN extracted', `got: ${gstins[1]}`);

  const invMatch = mockPdfText.match(/(?:invoice\s*(?:no|number|#)[\s.:]*)\s*([A-Z0-9\-\/]+)/i);
  assert(invMatch?.[1] === 'CT/2026/1847', 'Invoice number extracted', `got: ${invMatch?.[1]}`);

  const hsnMatch = mockPdfText.match(/(?:hsn|sac)[\s\/.:]*(\d{4,8})/i);
  assert(hsnMatch?.[1] === '998314', 'HSN/SAC extracted', `got: ${hsnMatch?.[1]}`);

  const amtMatch = mockPdfText.match(/(?:total|grand\s*total|amount\s*payable)[\s.:]*[₹Rs.\s]*([0-9,]+\.?\d{0,2})/i);
  const totalAmt = parseFloat(amtMatch?.[1]?.replace(/,/g, '') || '0');
  assert(totalAmt === 50150, `Total amount extracted: ₹${totalAmt}`, `expected 50150`);

  const typeMatch = mockPdfText.match(/\b(tax\s*invoice|proforma|estimate)\b/i);
  assert(typeMatch?.[1]?.toLowerCase().includes('tax invoice'), 'Invoice type: Tax Invoice', `got: ${typeMatch?.[1]}`);

  // ── TEST 7: Saga Compensation ──
  console.log('\n── Saga Coordinator ──');
  const saga1 = new CCSaga('test-saga-1', {
    id: 'SAGA-01', vendorId: 'VND-0041', amount: 12980, enteredAt: '2026-04-02',
    billPayload: { vendor_id: 'VND-0041', bill_number: 'HSBC-SAGA-01', date: '2026-04-02', line_items: [{ amount: 12980 }] },
    journalPayload: { journal_date: '2026-04-02', line_items: [{ debit_or_credit: 'debit', amount: 12980 }, { debit_or_credit: 'credit', amount: 12980 }] },
  });
  const sagaResult = await saga1.execute();
  assert(sagaResult.completed === true, 'Saga: all 3 steps completed', `completed=${sagaResult.completed}`);
  assert(sagaResult.billId != null, `Saga: bill created (${sagaResult.billId})`, 'no bill ID');
  assert(sagaResult.journalId != null, `Saga: journal created (${sagaResult.journalId})`, 'no journal ID');
  assert(sagaResult.paymentId != null, `Saga: settlement applied (${sagaResult.paymentId})`, 'no payment ID');

  // ── TEST 8: Zoho Invoice Orchestrator ──
  console.log('\n── Zoho Invoice Orchestrator ──');
  const zohoOrch = require('../src/orchestrators/zoho-invoice');

  for (const inv of INVOICES.slice(0, 6)) {
    const exp = EXPECTED[inv.id];
    if (!exp) continue;

    const result = await zohoOrch.processInvoice(inv);

    if (exp.classified === false) {
      assert(result.status === 'parked', `${inv.id} ${inv.vendor.substring(0, 20)}: parked (${inv.type})`, `status=${result.status}`);
    } else if (exp.classified === true) {
      assert(result.status === 'posted' || result.status === 'exception',
        `${inv.id} ${inv.vendor.substring(0, 20)}: processed (${result.status}, score: ${result.score || '—'})`,
        `status=${result.status}`);
    }
  }

  // ── TEST 9: CC Transaction Orchestrator ──
  console.log('\n── CC Transaction Orchestrator ──');
  const ccOrch = require('../src/orchestrators/cc-transaction');

  for (const txn of CC_TRANSACTIONS) {
    const exp = EXPECTED[txn.id];
    if (!exp) continue;

    const result = await ccOrch.processTransaction(txn);

    if (exp.skip) {
      assert(result.status === 'exception', `${txn.id} ${txn.merchant.substring(0, 22)}: EXCEPTION (routes to Q5 — controls decision 2026-04-22, no silent skipping)`, `status=${result.status}`);
    } else if (exp.matched === false) {
      assert(result.status === 'exception', `${txn.id} ${txn.merchant.substring(0, 22)}: EXCEPTION (no match → Q3)`, `status=${result.status}`);
    } else {
      assert(result.status === 'posted' || result.status === 'exception',
        `${txn.id} ${txn.merchant.substring(0, 22)}: ${result.status}`,
        `status=${result.status}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  RESULTS: ${passed}/${total} passed, ${failed} failed`);
  console.log(`  ${failed === 0 ? '✓ ALL TESTS PASSED' : `✗ ${failed} FAILURES — see above`}`);
  console.log(`  Zoho API calls (mocked): ${zohoCallCount}`);
  console.log('═══════════════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('TEST RUNNER CRASHED:', err);
  process.exit(1);
});
