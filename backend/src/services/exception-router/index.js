// src/services/exception-router/index.js — Exception queue routing
// Routes rule failures to Q1-Q8. Creates PostgreSQL exception records.
// Sends Slack DM to queue owner. Tracks SLA deadlines.
// R11: staggered recheck handled by cron (not this service).

const { query } = require('../../infra/db/pool');
const audit = require('../audit-logger');
const config = require('../../../config');

// SLA to deadline calculation
const SLA_HOURS = { 'immediate': 1, '24h': 24, '48h': 48, '3d': 72 };

function slaToDeadline(sla) {
  const hours = SLA_HOURS[sla] || 24;
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

async function route({ failures, sourceType, correlationId, billContext }) {
  const start = Date.now();

  // Group failures by queue bucket
  const byQueue = {};
  for (const f of failures) {
    const q = f.queue_bucket;
    if (!q || q === '—') continue;
    if (!byQueue[q]) byQueue[q] = [];
    byQueue[q].push(f);
  }

  const assignments = [];

  for (const [queueId, queueFailures] of Object.entries(byQueue)) {
    const queueConfig = config.queues[queueId];
    if (!queueConfig) {
      console.warn(`[EXCEPTION] Unknown queue: ${queueId}`);
      continue;
    }

    const slaDeadline = slaToDeadline(queueConfig.sla);
    const summary = queueFailures.map(f => `${f.rule_id}: ${f.detail || f.name || 'Failed'}`).join('. ');

    // Get or reference the bill_lifecycle record
    const billRef = await query(
      `SELECT id FROM bill_lifecycle WHERE correlation_id = $1 LIMIT 1`,
      [correlationId]
    );
    const billLifecycleId = billRef.rows[0]?.id || null;

    // Create exception record
    const result = await query(
      `INSERT INTO exceptions
        (correlation_id, bill_lifecycle_id, queue_bucket, owner, sla,
         rule_failures, failure_summary, sla_deadline, next_recheck_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + INTERVAL '1 hour')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        correlationId, billLifecycleId, queueId,
        queueConfig.owner, queueConfig.sla,
        JSON.stringify(queueFailures), summary, slaDeadline,
      ]
    );

    const exceptionId = result.rows[0]?.id;

    // Send Slack notification
    let slackSent = false;
    try {
      slackSent = await sendSlackAlert(queueId, queueConfig, correlationId, billContext, summary);
    } catch (err) {
      console.error(`[EXCEPTION] Slack alert failed for ${queueId}:`, err.message);
    }

    assignments.push({
      queue: queueId,
      name: queueConfig.name,
      owner: queueConfig.owner,
      sla: queueConfig.sla,
      slaDeadline: slaDeadline.toISOString(),
      failureCount: queueFailures.length,
      exceptionId,
      slackSent,
    });

    await audit.logException(correlationId, queueId, queueFailures);
  }

  // Update bill lifecycle status to 'exception'
  await query(
    `UPDATE bill_lifecycle SET status = 'exception', failed_queues = $1 WHERE correlation_id = $2`,
    [Object.keys(byQueue), correlationId]
  );

  const output = { queueAssignments: assignments };

  await audit.logServiceCall(
    correlationId, 'A2', 'exception_route',
    { failureCount: failures.length, sourceType },
    { queuesRouted: assignments.length, queues: assignments.map(a => a.queue) },
    Date.now() - start, null
  );

  return output;
}

// ── Slack alert ──

async function sendSlackAlert(queueId, queueConfig, correlationId, billContext, summary) {
  const slackToken = config.slack.botToken;
  if (!slackToken) return false;

  const vendor = billContext?.vendorName || billContext?.merchantString || 'Unknown';
  const amount = billContext?.amount ? `₹${Number(billContext.amount).toLocaleString('en-IN')}` : '';

  const message = [
    `*Exception: ${queueConfig.name}* (${queueId})`,
    `Vendor: ${vendor} ${amount}`,
    `Ref: \`${correlationId}\``,
    `SLA: ${queueConfig.sla}`,
    `---`,
    summary.substring(0, 500),
  ].join('\n');

  try {
    const axios = require('axios');
    await axios.post('https://slack.com/api/chat.postMessage', {
      channel: config.slack.channels.exceptions,
      text: message,
      unfurl_links: false,
    }, {
      headers: { Authorization: `Bearer ${slackToken}`, 'Content-Type': 'application/json' },
    });
    return true;
  } catch (err) {
    console.error(`[SLACK] Failed to send: ${err.message}`);
    return false;
  }
}

// ── Recheck: re-run validation for open exceptions ──

async function recheckQueue(queueId) {
  const openExceptions = await query(
    `SELECT id, correlation_id, rule_failures
     FROM exceptions
     WHERE queue_bucket = $1 AND status = 'open'
     ORDER BY created_at ASC
     LIMIT 50`,
    [queueId]
  );

  let resolved = 0;
  let stillOpen = 0;

  for (const exc of openExceptions.rows) {
    // Update recheck tracking
    await query(
      `UPDATE exceptions
       SET last_recheck_at = NOW(), recheck_count = recheck_count + 1,
           next_recheck_at = NOW() + INTERVAL '1 hour'
       WHERE id = $1`,
      [exc.id]
    );

    // TODO: Agent 2/3/4 implements actual re-validation of the specific failed rules
    // For now, just update recheck count
    stillOpen++;
  }

  console.log(`[RECHECK] ${queueId}: ${openExceptions.rows.length} checked, ${resolved} resolved, ${stillOpen} still open`);
  return { queueId, checked: openExceptions.rows.length, resolved, stillOpen };
}

// ── Escalation check ──

async function checkEscalations() {
  // Find exceptions past SLA deadline that haven't been escalated
  const overdue = await query(
    `SELECT id, correlation_id, queue_bucket, owner, sla_deadline, escalation_level
     FROM exceptions
     WHERE status = 'open' AND sla_deadline < NOW() AND escalation_level < 3
     ORDER BY sla_deadline ASC`
  );

  for (const exc of overdue.rows) {
    const newLevel = exc.escalation_level + 1;
    const escalateTo = newLevel === 1 ? exc.owner : newLevel === 2 ? 'Finance Controller' : 'CFO';

    await query(
      `UPDATE exceptions SET escalation_level = $1, escalated_at = NOW() WHERE id = $2`,
      [newLevel, exc.id]
    );

    console.log(`[ESCALATION] ${exc.correlation_id} → level ${newLevel} (${escalateTo})`);
    // TODO: send escalation notification
  }

  return { escalated: overdue.rows.length };
}

module.exports = { route, recheckQueue, checkEscalations };
