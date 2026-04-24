// src/services/notification/index.js — Slack DM + email notifications
// Internal Slack: Hindi/English casual mix
// Vendor email: English formal
// Every message includes direct Zoho link + correlation ID

const axios = require('axios');
const config = require('../../../config');
const audit = require('../audit-logger');

const ZOHO_BILL_URL = `https://books.zoho.in/app/${config.zoho.orgId}#/bills`;

// ═══════════════════════════════════════════════════════════════
// SLACK MESSAGING
// ═══════════════════════════════════════════════════════════════

async function sendSlack({ channel, userId, text, blocks, correlationId }) {
  const token = config.slack.botToken;
  if (!token) {
    console.warn('[NOTIFY] Slack token not configured — skipping');
    return { sent: false, channel: 'slack', reason: 'no_token' };
  }

  try {
    const target = userId || channel;
    const resp = await axios.post('https://slack.com/api/chat.postMessage', {
      channel: target,
      text,
      blocks,
      unfurl_links: false,
    }, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    if (!resp.data?.ok) {
      throw new Error(resp.data?.error || 'Slack API error');
    }

    await audit.logServiceCall(correlationId, 'A4', 'slack_send', { channel: target }, { sent: true, ts: resp.data.ts }, 0, null);
    return { sent: true, channel: 'slack', timestamp: resp.data.ts, threadTs: resp.data.ts };
  } catch (err) {
    console.error('[NOTIFY] Slack send failed:', err.message);
    return { sent: false, channel: 'slack', error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// MESSAGE TEMPLATES
// ═══════════════════════════════════════════════════════════════

function approvalRequest(bill) {
  const link = `${ZOHO_BILL_URL}/${bill.zohoBillId || ''}`;
  return {
    text: `🔔 New bill needs genuineness check\n*${bill.vendorName}* — ₹${formatAmount(bill.amount)}\n${bill.description || ''}\nRef: \`${bill.correlationId}\`\n<${link}|Open in Zoho>`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*New bill needs your approval*` } },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*Vendor:*\n${bill.vendorName}` },
        { type: 'mrkdwn', text: `*Amount:*\n₹${formatAmount(bill.amount)}` },
        { type: 'mrkdwn', text: `*Invoice:*\n${bill.invoiceNumber || '—'}` },
        { type: 'mrkdwn', text: `*Ref:*\n\`${bill.correlationId}\`` },
      ]},
      { type: 'section', text: { type: 'mrkdwn', text: `<${link}|📎 Open in Zoho Books>` } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Is this bill genuine? Was this service actually received?` }] },
    ],
  };
}

function approvalReminder(bill, daysPending) {
  const urgency = daysPending >= 5 ? '🔴' : daysPending >= 2 ? '🟡' : '🟢';
  const link = `${ZOHO_BILL_URL}/${bill.zohoBillId || ''}`;
  return {
    text: `${urgency} Reminder: bill pending ${daysPending} days\n*${bill.vendorName}* — ₹${formatAmount(bill.amount)}\nRef: \`${bill.correlationId}\`\n<${link}|Open in Zoho>`,
  };
}

function exceptionNotice(exception) {
  return {
    text: `⚠️ Bill held: *${exception.queueName}* (${exception.queueBucket})\n*${exception.vendorName}* — ₹${formatAmount(exception.amount)}\nReason: ${exception.summary}\nRef: \`${exception.correlationId}\`\nSLA: ${exception.sla}`,
  };
}

function billApproved(bill) {
  return { text: `✅ Bill approved and posted: *${bill.vendorName}* — ₹${formatAmount(bill.amount)}\nRef: \`${bill.correlationId}\`` };
}

function billRejected(bill, reason) {
  return { text: `❌ Bill rejected: *${bill.vendorName}* — ₹${formatAmount(bill.amount)}\nReason: ${reason}\nRef: \`${bill.correlationId}\`` };
}

function escalationNotice(bill, level) {
  const escalateMsg = level === 2 ? 'Escalated to Finance Controller' : level === 3 ? 'Final escalation to CFO' : 'Reminder sent';
  return { text: `🔺 ${escalateMsg}: *${bill.vendorName}* — ₹${formatAmount(bill.amount)} pending ${bill.daysPending} days\nRef: \`${bill.correlationId}\`` };
}

// ═══════════════════════════════════════════════════════════════
// DIGEST — summary sent every 12 hours
// ═══════════════════════════════════════════════════════════════

function dailyDigest(stats) {
  const lines = [
    `📊 *AP Autopilot — ${stats.period} Digest*`,
    ``,
    `*Pipeline:*`,
    `• Bills processed: ${stats.processed}`,
    `• Posted: ${stats.posted} | Exceptions: ${stats.exceptions} | Skipped: ${stats.skipped}`,
    ``,
    `*Exception queues:*`,
    ...Object.entries(stats.queues).map(([q, count]) => `• ${q}: ${count} open`),
    ``,
    `*Pending approvals:* ${stats.pendingApprovals}`,
    stats.oldestPending ? `• Oldest: ${stats.oldestPending.vendorName} (${stats.oldestPending.daysPending} days)` : '',
    ``,
    `*SLA breaches:* ${stats.slaBreaches}`,
  ].filter(Boolean);

  return { text: lines.join('\n') };
}

// ═══════════════════════════════════════════════════════════════
// SEND HELPERS
// ═══════════════════════════════════════════════════════════════

async function notifyApprover(approverId, bill) {
  const msg = approvalRequest(bill);
  return sendSlack({ userId: approverId, ...msg, correlationId: bill.correlationId });
}

async function notifyException(ownerId, exception) {
  const msg = exceptionNotice(exception);
  return sendSlack({ userId: ownerId, ...msg, correlationId: exception.correlationId });
}

async function notifyChannel(channelName, message, correlationId) {
  return sendSlack({ channel: channelName, text: message, correlationId });
}

async function sendDigest(recipientIds, stats) {
  const msg = dailyDigest(stats);
  const results = [];
  for (const userId of recipientIds) {
    results.push(await sendSlack({ userId, ...msg, correlationId: 'digest' }));
  }
  return results;
}

function formatAmount(amt) {
  return Number(amt || 0).toLocaleString('en-IN');
}

module.exports = {
  sendSlack, notifyApprover, notifyException, notifyChannel, sendDigest,
  approvalRequest, approvalReminder, exceptionNotice, billApproved, billRejected,
  escalationNotice, dailyDigest,
};
