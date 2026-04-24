// config/index.js — Single source of truth for all configuration
// All secrets live in Railway environment variables. Zero secrets in code.

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000'),

  // ── Deploy mode: 'draft' (Phase 1) or 'live' (Phase 2) ──
  // Phase 1: all entries go to draft/QA. Phase 2: live posting after FC sign-off.
  // R03 mitigation: epoch-based transition uses LIVE_EPOCH_CUTOFF.
  deployMode: process.env.DEPLOY_MODE || 'draft',
  liveEpochCutoff: process.env.LIVE_EPOCH_CUTOFF || null, // ISO timestamp

  // ── PostgreSQL (Railway plugin) ──
  database: {
    url: process.env.DATABASE_URL,
    pool: { min: 2, max: 10, idleTimeoutMillis: 30000 },
  },

  // ── Redis (Railway plugin) ──
  redis: {
    url: process.env.REDIS_URL,
    cacheRefreshMinutes: 15,
    stalenessAlertMinutes: 30,
  },

  // ── Zoho Books API ──
  zoho: {
    orgId: process.env.ZOHO_ORG_ID || '60036724867',
    clientId: process.env.ZOHO_CLIENT_ID,
    clientSecret: process.env.ZOHO_CLIENT_SECRET,
    refreshToken: process.env.ZOHO_REFRESH_TOKEN,
    accessToken: null, // set at runtime by zoho-auth
    tokenExpiresAt: null,
    baseUrl: 'https://www.zohoapis.in/books/v3',
    rateLimit: { maxPerMinute: 40, reservedForHealth: 10 },
    healthCheckIntervalMs: 5 * 60 * 1000, // 5 minutes (R04)
  },

  // ── Google Sheets API (rules engine) ──
  sheets: {
    serviceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY, // JSON string
    rulesSheetId: process.env.RULES_SHEET_ID || '1xGH3kJ8xKKgeymVMZ7Qzbbc9QX0kBLzC4KUlp8_kEzY',
    merchantMapTab: 'CC Merchant Map',
    matchConfigTab: 'CC Match Config',
    versionHashCell: 'Rule Status Dashboard!R1', // version hash for quick diff
  },

  // ── Slack ──
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN,
    channels: {
      exceptions: process.env.SLACK_CHANNEL_EXCEPTIONS || 'C06048FPGP9',    // #finance
      critical: process.env.SLACK_CHANNEL_CRITICAL || 'C0APUM17ZAL',      // #finance-and-ptl
    },
  },

  // ── Key Zoho IDs (from V9 doc Part 5) ──
  zohoIds: {
    igst18TaxId: '2295010000001409879',
    gst18TaxId: '2295010000001409981',
    accountsPayable: '2295010000000000471',
    suspenseAccount: '2295010000001621645',
    staffWelfare: '2295010000000044787',
    defaultHsbcCc: '2295010000002901910',
    maheshUserId: '2295010000000931179',
    cfProjectId: '2295010000003329419',
    cfDeptId: '2295010000003734096',
  },

  // ── Card holder mapping ──
  cardHolders: {
    '4521': { holder: 'Tushar Mehta', zohoAccountId: '2295010000002901910', accountName: 'HSBC CC - Tushar' },
    '7893': { holder: 'Akash Jain', zohoAccountId: '2295010000002901911', accountName: 'HSBC CC - Akash' },
  },

  // ── Exception queue config ──
  queues: {
    Q1: { name: 'GST / RCM failures', owner: 'Saurav', sla: '24h', recheckMinute: 0 },
    Q2: { name: 'TDS section mismatch', owner: 'Saurav', sla: '24h', recheckMinute: 7 },
    Q3: { name: 'Vendor not found', owner: 'Tushar', sla: '3d', recheckMinute: 15 },
    Q4: { name: 'Duplicate detected', owner: 'Mahesh', sla: 'immediate', recheckMinute: 22 },
    Q5: { name: 'Amount mismatch', owner: 'Tushar', sla: '24h', recheckMinute: 30 },
    Q6: { name: 'Missing documents', owner: 'Tushar', sla: '48h', recheckMinute: 37 },
    Q7: { name: 'GL mapping unclear', owner: 'Mahesh', sla: '24h', recheckMinute: 45 },
    Q8: { name: 'Proof-check mismatch', owner: 'Tushar', sla: 'immediate', recheckMinute: 52 },
  },

  // ── Fuzzy matching config ──
  fuzzy: {
    enabled: true,
    threshold: 0.80,
    autoConfirm: false, // NEVER auto-confirm fuzzy matches
    maxSuggestions: 3,
  },

  // ── Score gate ──
  scoring: {
    autoThreshold: 90,
    approvalThreshold: 70,
    exceptionThreshold: 69,
  },
};

// ── Validation — fail fast on missing critical config ──
function validate() {
  const required = ['database.url', 'redis.url'];
  const missing = required.filter(key => {
    const val = key.split('.').reduce((o, k) => o?.[k], config);
    return !val;
  });
  if (missing.length > 0 && config.env !== 'test') {
    console.error(`Missing required config: ${missing.join(', ')}`);
    console.error('Set these in Railway environment variables.');
    process.exit(1);
  }
}

if (config.env !== 'test') validate();

module.exports = config;
