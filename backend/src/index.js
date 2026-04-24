// src/index.js — Main entry point for Wiom Finance Autopilot
// Startup sequence: connect DB → connect Redis → warm rules cache → start server → start crons
// If any critical step fails, the process exits (fail fast, don't serve bad state)

const express = require('express');
const config = require('../config');
const db = require('./infra/db/pool');
const cache = require('./infra/cache/redis');
const { warmOnStart, refreshRules } = require('./rules/sheet-reader');
const { CronJob } = require('cron');

const app = express();
app.use(express.json());

// ═══════════════════════════════════════════════════════════════
// HEALTH CHECK — system status at a glance
// ═══════════════════════════════════════════════════════════════

app.get('/health', async (req, res) => {
  const [dbHealth, cacheHealth] = await Promise.all([
    db.healthCheck(),
    cache.healthCheck(),
  ]);

  const healthy = dbHealth.healthy && cacheHealth.healthy && !cacheHealth.stale;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    deployMode: config.deployMode,
    version: '9.0.0',
    uptime: Math.round(process.uptime()),
    checks: {
      database: dbHealth,
      cache: cacheHealth,
    },
  });
});

// ── Detailed system state for dashboard ──
app.get('/status', async (req, res) => {
  const staleness = await cache.checkStaleness();
  const version = await cache.getRulesVersion();

  res.json({
    deployMode: config.deployMode,
    liveEpochCutoff: config.liveEpochCutoff,
    rulesVersion: version ? version.substring(0, 8) : null,
    rulesStaleness: staleness,
    scoring: config.scoring,
    queues: config.queues,
  });
});

// ── Audit trail for a specific bill ──
app.get('/audit/:correlationId', async (req, res) => {
  const auditLogger = require('./services/audit-logger');
  const trail = await auditLogger.getAuditTrail(req.params.correlationId);
  res.json({ correlationId: req.params.correlationId, events: trail });
});

// ── Manual rules refresh trigger ──
app.post('/rules/refresh', async (req, res) => {
  const result = await refreshRules();
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// CRON JOBS — staggered rechecks, rules refresh, follow-ups
// ═══════════════════════════════════════════════════════════════

function setupCrons() {
  const { recheckQueue, checkEscalations } = require('./services/exception-router');
  const { runFollowUpCycle } = require('./infra/cron/follow-up');
  const { healthProbe, proactiveRefresh } = require('./services/zoho-poster/auth');

  // Rules cache refresh every 15 minutes
  new CronJob('*/15 * * * *', async () => {
    console.log('[CRON] Rules refresh triggered');
    await refreshRules();
  }, null, true);

  // Staggered exception queue rechecks (R11 mitigation)
  for (const [queueId, queueConfig] of Object.entries(config.queues)) {
    new CronJob(`${queueConfig.recheckMinute} * * * *`, async () => {
      console.log(`[CRON] Recheck ${queueId} (${queueConfig.name})`);
      try { await recheckQueue(queueId); } catch (e) { console.error(`[CRON] Recheck ${queueId} failed:`, e.message); }
    }, null, true);
  }

  // A4 follow-up agent: every 12 hours (6am and 6pm IST = 0:30 and 12:30 UTC)
  new CronJob('30 0,12 * * *', async () => {
    console.log('[CRON] A4 follow-up cycle triggered');
    try { await runFollowUpCycle(); } catch (e) { console.error('[CRON] A4 follow-up failed:', e.message); }
  }, null, true);

  // Escalation check every 4 hours
  new CronJob('0 */4 * * *', async () => {
    try { await checkEscalations(); } catch (e) { console.error('[CRON] Escalation check failed:', e.message); }
  }, null, true);

  // Zoho OAuth health check every 5 minutes (R04) + proactive refresh
  new CronJob('*/5 * * * *', async () => {
    try {
      await proactiveRefresh();
      const health = await healthProbe();
      if (!health.healthy) console.error('[CRON] Zoho health FAILED:', health.reason);
    } catch (e) { console.error('[CRON] Zoho health check failed:', e.message); }
  }, null, true);

  console.log('[CRON] All cron jobs scheduled');
}

// ═══════════════════════════════════════════════════════════════
// STARTUP SEQUENCE
// ═══════════════════════════════════════════════════════════════

async function startup() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  WIOM FINANCE AUTOPILOT V9');
  console.log(`  Mode: ${config.deployMode.toUpperCase()} | Env: ${config.env}`);
  console.log('═══════════════════════════════════════════════════');

  // Step 1: Connect to PostgreSQL
  console.log('[STARTUP] Connecting to PostgreSQL...');
  const dbCheck = await db.healthCheck();
  if (!dbCheck.healthy) {
    console.error('[STARTUP] FATAL: Cannot connect to PostgreSQL:', dbCheck.error);
    process.exit(1);
  }
  console.log('[STARTUP] PostgreSQL connected');

  // Step 2: Connect to Redis
  console.log('[STARTUP] Connecting to Redis...');
  await cache.connect();
  const cacheCheck = await cache.healthCheck();
  if (!cacheCheck.healthy) {
    console.error('[STARTUP] FATAL: Cannot connect to Redis:', cacheCheck.error);
    process.exit(1);
  }
  console.log('[STARTUP] Redis connected');

  // Step 3: Warm rules cache (R06 — blocks until rules are loaded)
  console.log('[STARTUP] Warming rules cache...');
  try {
    await warmOnStart();
  } catch (err) {
    console.error('[STARTUP] FATAL: Could not warm rules cache:', err.message);
    console.error('[STARTUP] System CANNOT process bills without rules. Fix Google Sheets connection and restart.');
    process.exit(1);
  }

  // Step 4: Start Express server
  app.listen(config.port, () => {
    console.log(`[STARTUP] Server listening on port ${config.port}`);
  });

  // Step 5: Start cron jobs
  setupCrons();

  console.log('[STARTUP] System ready');
  console.log(`[STARTUP] Deploy mode: ${config.deployMode}`);
  if (config.deployMode === 'draft') {
    console.log('[STARTUP] ⚠ PHASE 1: All entries will be DRAFT — no live posting');
  }
}

// ── Graceful shutdown ──
process.on('SIGTERM', async () => {
  console.log('[SHUTDOWN] SIGTERM received — shutting down gracefully');
  await cache.disconnect();
  await db.pool.end();
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  console.error('[FATAL] Unhandled rejection:', err);
  process.exit(1);
});

startup().catch(err => {
  console.error('[FATAL] Startup failed:', err);
  process.exit(1);
});
