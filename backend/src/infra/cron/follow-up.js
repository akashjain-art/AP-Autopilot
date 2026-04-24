// src/infra/cron/follow-up.js — A4 Follow-up + Notification Agent
// Runs every 12 hours (6am and 6pm IST) + immediate triggers
// Primary: bills pending business approval (89% through Mahesh → routing table fixes this)
// Secondary: anything stuck between L5 and L6 (ideally zero)

const { query } = require('../db/pool');
const notification = require('../../services/notification');
const exceptionRouter = require('../../services/exception-router');
const audit = require('../../services/audit-logger');
const config = require('../../../config');

// ═══════════════════════════════════════════════════════════════
// MAIN CYCLE — runs every 12 hours
// ═══════════════════════════════════════════════════════════════

async function runFollowUpCycle() {
  const start = Date.now();
  console.log('[A4] Starting 12-hour follow-up cycle');

  const results = {
    pendingApprovals: 0,
    reminders: { sent: 0, failed: 0 },
    escalations: { l1: 0, l2: 0, cfo: 0 },
    digest: { sent: false },
    exceptions: { rechecked: 0 },
  };

  try {
    // ── 1. Scan all pending approvals ──
    const pending = await query(`
      SELECT bl.correlation_id, bl.vendor_name, bl.amount, bl.invoice_number,
             bl.zoho_bill_id, bl.entered_at, bl.score,
             EXTRACT(EPOCH FROM (NOW() - bl.entered_at)) / 86400 as days_pending
      FROM bill_lifecycle bl
      WHERE bl.source = 'zoho' AND bl.status = 'approval_pending'
      ORDER BY bl.entered_at ASC
    `);

    results.pendingApprovals = pending.rows.length;
    console.log(`[A4] Found ${pending.rows.length} bills pending approval`);

    // ── 2. Send reminders based on aging ──
    for (const bill of pending.rows) {
      const daysPending = Math.round(bill.days_pending);
      const billContext = {
        correlationId: bill.correlation_id,
        vendorName: bill.vendor_name,
        amount: bill.amount,
        invoiceNumber: bill.invoice_number,
        zohoBillId: bill.zoho_bill_id,
        daysPending,
      };

      try {
        if (daysPending >= 10) {
          // Final escalation to CFO
          const msg = notification.escalationNotice(billContext, 3);
          await notification.sendSlack({ channel: config.slack.channels.critical, ...msg, correlationId: bill.correlation_id });
          results.escalations.cfo++;
          await audit.logPipelineStep(bill.correlation_id, 'A4', 'escalation_cfo', `${daysPending} days pending → CFO escalation`);
        } else if (daysPending >= 5) {
          // Escalate to L2 approver
          const msg = notification.escalationNotice(billContext, 2);
          await notification.sendSlack({ channel: config.slack.channels.exceptions, ...msg, correlationId: bill.correlation_id });
          results.escalations.l2++;
        } else if (daysPending >= 2) {
          // First reminder to L1 approver
          const msg = notification.approvalReminder(billContext, daysPending);
          await notification.sendSlack({ channel: config.slack.channels.exceptions, ...msg, correlationId: bill.correlation_id });
          results.escalations.l1++;
        }
        // All pending bills get included in the digest (below)
        results.reminders.sent++;
      } catch (err) {
        console.error(`[A4] Reminder failed for ${bill.correlation_id}:`, err.message);
        results.reminders.failed++;
      }
    }

    // ── 3. Check exception queue escalations ──
    const escalationResult = await exceptionRouter.checkEscalations();
    results.exceptions.rechecked = escalationResult.escalated;

    // ── 4. Generate and send digest ──
    const stats = await gatherDigestStats();
    stats.period = new Date().getHours() < 12 ? 'Morning' : 'Evening';
    stats.pendingApprovals = results.pendingApprovals;
    stats.oldestPending = pending.rows[0] ? {
      vendorName: pending.rows[0].vendor_name,
      daysPending: Math.round(pending.rows[0].days_pending),
    } : null;

    // Send to CFO + Tushar + dept approvers (from config decision item #7)
    // TODO: make recipient list configurable
    const digestResult = await notification.notifyChannel(
      config.slack.channels.exceptions,
      notification.dailyDigest(stats).text,
      'digest'
    );
    results.digest.sent = digestResult.sent;

  } catch (err) {
    console.error('[A4] Follow-up cycle error:', err.message);
  }

  const duration = Date.now() - start;
  console.log(`[A4] Cycle complete in ${duration}ms:`, JSON.stringify(results));
  return results;
}

// ═══════════════════════════════════════════════════════════════
// IMMEDIATE TRIGGERS — on specific events
// ═══════════════════════════════════════════════════════════════

async function onBillPosted(correlationId, billData) {
  // SUB-001: notify submitter that bill was approved and posted
  const msg = notification.billApproved(billData);
  await notification.sendSlack({ channel: config.slack.channels.exceptions, ...msg, correlationId });
}

async function onBillRejected(correlationId, billData, reason) {
  // SUB-002: notify submitter with reason
  const msg = notification.billRejected(billData, reason);
  await notification.sendSlack({ channel: config.slack.channels.exceptions, ...msg, correlationId });
}

async function onNewBillPendingApproval(correlationId, billData, approverId) {
  // Immediate: notify assigned approver
  await notification.notifyApprover(approverId || config.zohoIds.maheshUserId, billData);
}

// ═══════════════════════════════════════════════════════════════
// DIGEST STATS — gather data for the summary
// ═══════════════════════════════════════════════════════════════

async function gatherDigestStats() {
  const now = new Date();
  const halfDayAgo = new Date(now - 12 * 60 * 60 * 1000);

  // Bills processed in last 12 hours
  const processed = await query(
    `SELECT COUNT(*) as cnt FROM bill_lifecycle WHERE entered_at > $1`,
    [halfDayAgo]
  );

  const posted = await query(
    `SELECT COUNT(*) as cnt FROM bill_lifecycle WHERE status = 'posted' AND posted_at > $1`,
    [halfDayAgo]
  );

  const exceptions = await query(
    `SELECT COUNT(*) as cnt FROM bill_lifecycle WHERE status = 'exception' AND entered_at > $1`,
    [halfDayAgo]
  );

  const skipped = await query(
    `SELECT COUNT(*) as cnt FROM bill_lifecycle WHERE status = 'skipped' AND entered_at > $1`,
    [halfDayAgo]
  );

  // Open exceptions by queue
  const queueCounts = await query(
    `SELECT queue_bucket, COUNT(*) as cnt FROM exceptions WHERE status = 'open' GROUP BY queue_bucket ORDER BY queue_bucket`
  );

  // SLA breaches
  const slaBreaches = await query(
    `SELECT COUNT(*) as cnt FROM exceptions WHERE status = 'open' AND sla_deadline < NOW()`
  );

  return {
    processed: parseInt(processed.rows[0]?.cnt || 0),
    posted: parseInt(posted.rows[0]?.cnt || 0),
    exceptions: parseInt(exceptions.rows[0]?.cnt || 0),
    skipped: parseInt(skipped.rows[0]?.cnt || 0),
    queues: Object.fromEntries(queueCounts.rows.map(r => [r.queue_bucket, parseInt(r.cnt)])),
    slaBreaches: parseInt(slaBreaches.rows[0]?.cnt || 0),
  };
}

module.exports = {
  runFollowUpCycle,
  onBillPosted, onBillRejected, onNewBillPendingApproval,
  gatherDigestStats,
};
