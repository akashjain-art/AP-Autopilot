// src/rules/rule-executor.js — Execute rules from cache by stage + source filter
// Reads cached rules from Redis. Runs in execution_order. Checks depends_on.
// Returns scored results with queue routing.

const cache = require('../infra/cache/redis');
const { RULE_TABS } = require('./sheet-reader');

// ── Get rules for a specific execution stage and source ──

async function getRulesForStage(stage, sourceType) {
  const allRules = [];
  for (const tab of RULE_TABS) {
    const tabRules = await cache.getRules(tab);
    if (!tabRules) continue;
    const filtered = tabRules.filter(r =>
      r.executed_by === stage &&
      (r.source_filter === 'all' || r.source_filter === sourceType) &&
      r.enabled !== false
    );
    allRules.push(...filtered.map(r => ({ ...r, tab })));
  }
  // Sort by execution_order
  allRules.sort((a, b) => (a.execution_order || 99) - (b.execution_order || 99));
  return allRules;
}

// ── Get all rules for a specific tab ──

async function getRulesForTab(tabName) {
  return await cache.getRules(tabName) || [];
}

// ── Execute a single rule against a bill context ──
// The actual condition evaluation is done by the calling service.
// This function provides the framework: logging, scoring, queue routing.

function buildRuleResult(rule, passed, detail) {
  return {
    rule_id: rule.rule_id,
    name: rule.name,
    tab: rule.tab || '',
    stage: rule.executed_by,
    passed,
    severity: rule.severity || 'info',
    penalty: passed ? 0 : (parseInt(rule.score_penalty) || 0),
    on_fail_action: rule.on_fail_action,
    queue_bucket: passed ? null : (rule.queue_bucket || null),
    detail,
    depends_on: rule.depends_on || null,
  };
}

// ── Calculate score from rule results ──

function calculateScore(results) {
  const totalPenalty = results
    .filter(r => !r.passed)
    .reduce((sum, r) => sum + (r.penalty || 0), 0);
  return Math.max(0, 100 + totalPenalty);
}

// ── Determine route from score ──

function determineRoute(score, sourceType) {
  if (sourceType === 'cc') return 'cc_pipeline'; // CC skips score gate
  if (score >= 90) return 'auto';
  if (score >= 70) return 'approval';
  return 'exception';
}

// ── Get failed queues from results ──

function getFailedQueues(results) {
  const queues = results
    .filter(r => !r.passed && r.queue_bucket && r.queue_bucket !== '—')
    .map(r => r.queue_bucket);
  return [...new Set(queues)];
}

// ── Check if a rule's dependencies are met ──

function checkDependency(rule, previousResults) {
  if (!rule.depends_on || rule.depends_on === '—') return true;
  const depResult = previousResults.find(r => r.rule_id === rule.depends_on);
  return depResult ? depResult.passed : true; // if dep not found, allow (might be from different stage)
}

// ── Summary stats from results ──

function summarizeResults(results) {
  const score = calculateScore(results);
  return {
    total: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    criticalFails: results.filter(r => !r.passed && r.severity === 'critical').length,
    warningFails: results.filter(r => !r.passed && r.severity === 'warning').length,
    score,
    failedQueues: getFailedQueues(results),
    failedRules: results.filter(r => !r.passed).map(r => r.rule_id),
  };
}

module.exports = {
  getRulesForStage, getRulesForTab,
  buildRuleResult, calculateScore, determineRoute,
  getFailedQueues, checkDependency, summarizeResults,
};
