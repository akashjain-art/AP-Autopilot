// src/services/audit-logger/index.js — Audit trail with correlation ID threading
// R10 mitigation: every service call logs with correlation_id.
// One query reconstructs the entire decision chain for any bill.

const { query } = require('../../infra/db/pool');
const { v4: uuidv4 } = require('uuid');

// ── Generate correlation ID for a new bill entering the pipeline ──

function generateCorrelationId(source, identifier) {
  const ts = Date.now();
  const short = uuidv4().substring(0, 8);
  return `BILL-${source.toUpperCase()}-${identifier || short}-${ts}`;
}

// ── Log an audit event ──

async function log(event) {
  const {
    correlationId, eventType, agent, ruleId = null,
    inputSnapshot = null, outputSnapshot = null,
    passed = null, severity = null, penalty = 0,
    queueBucket = null, durationMs = null, errorMessage = null,
  } = event;

  try {
    await query(
      `INSERT INTO audit_events
        (correlation_id, event_type, agent, rule_id, input_snapshot, output_snapshot,
         passed, severity, penalty, queue_bucket, duration_ms, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        correlationId, eventType, agent, ruleId,
        inputSnapshot ? JSON.stringify(inputSnapshot) : null,
        outputSnapshot ? JSON.stringify(outputSnapshot) : null,
        passed, severity, penalty, queueBucket, durationMs, errorMessage,
      ]
    );
  } catch (err) {
    // Audit logging should never crash the pipeline — log and continue
    console.error(`[AUDIT] Failed to log event: ${err.message}`, { correlationId, eventType });
  }
}

// ── Convenience methods for common event types ──

async function logRuleCheck(correlationId, agent, ruleResult, durationMs) {
  await log({
    correlationId,
    eventType: 'rule_check',
    agent,
    ruleId: ruleResult.rule_id,
    inputSnapshot: { rule: ruleResult.name, tab: ruleResult.tab },
    outputSnapshot: { detail: ruleResult.detail },
    passed: ruleResult.passed,
    severity: ruleResult.severity,
    penalty: ruleResult.penalty,
    queueBucket: ruleResult.queue_bucket,
    durationMs,
  });
}

async function logServiceCall(correlationId, agent, serviceName, input, output, durationMs, error) {
  await log({
    correlationId,
    eventType: `service_${serviceName}`,
    agent,
    inputSnapshot: input,
    outputSnapshot: output,
    passed: !error,
    durationMs,
    errorMessage: error || null,
  });
}

async function logPipelineStep(correlationId, agent, step, detail) {
  await log({
    correlationId,
    eventType: 'pipeline_step',
    agent,
    inputSnapshot: { step },
    outputSnapshot: { detail },
    passed: true,
  });
}

async function logException(correlationId, queueBucket, failures) {
  await log({
    correlationId,
    eventType: 'exception_routed',
    agent: 'A2',
    inputSnapshot: { failures },
    outputSnapshot: { queue: queueBucket },
    passed: false,
    queueBucket,
  });
}

async function logZohoPost(correlationId, entryType, zohoId, draftMode) {
  await log({
    correlationId,
    eventType: `zoho_post_${entryType}`,
    agent: 'A3',
    outputSnapshot: { zoho_id: zohoId, draft_mode: draftMode, entry_type: entryType },
    passed: !!zohoId,
  });
}

// ── Query audit trail for a specific bill ──

async function getAuditTrail(correlationId) {
  const result = await query(
    `SELECT * FROM audit_events WHERE correlation_id = $1 ORDER BY created_at ASC`,
    [correlationId]
  );
  return result.rows;
}

// ── Get recent audit events (for dashboard) ──

async function getRecentEvents(limit = 50) {
  const result = await query(
    `SELECT * FROM audit_events ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

module.exports = {
  generateCorrelationId, log,
  logRuleCheck, logServiceCall, logPipelineStep,
  logException, logZohoPost,
  getAuditTrail, getRecentEvents,
};
