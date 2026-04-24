// src/services/score-calculator/index.js — Score calculation + route decision
// Only used by Zoho invoice orchestrator. CC transactions skip scoring entirely.
// Score = 100 + sum(penalties of failed rules). Critical = -30, Warning = -10, Info = 0.

const config = require('../../../config');
const audit = require('../audit-logger');

async function calculate({ ruleResults, sourceType, correlationId }) {
  // CC skips scoring — route directly to CC pipeline
  if (sourceType === 'cc') {
    return {
      score: null,
      route: 'cc_pipeline',
      failedRules: [],
      failedQueues: [],
      breakdown: { total: 0, passed: 0, criticalFails: 0, warningFails: 0 },
    };
  }

  const failed = ruleResults.filter(r => !r.passed);
  const totalPenalty = failed.reduce((sum, r) => sum + (r.penalty || 0), 0);
  const score = Math.max(0, 100 + totalPenalty);

  const criticalFails = failed.filter(r => r.severity === 'critical').length;
  const warningFails = failed.filter(r => r.severity === 'warning').length;

  // Determine route based on score thresholds from config
  let route;
  if (score >= config.scoring.autoThreshold) route = 'auto';        // 90+
  else if (score >= config.scoring.approvalThreshold) route = 'approval'; // 70-89
  else route = 'exception';                                          // 0-69

  // Phase 1 override: everything to exception
  const effectiveRoute = config.deployMode === 'draft' ? 'exception' : route;

  // Collect unique failed queues
  const failedQueues = [...new Set(
    failed.map(r => r.queue_bucket).filter(q => q && q !== '—' && q !== 'null')
  )];

  const result = {
    score,
    route: effectiveRoute,
    naturalRoute: route,  // what the route WOULD be without Phase 1 override
    failedRules: failed.map(r => r.rule_id),
    failedQueues,
    breakdown: {
      total: ruleResults.length,
      passed: ruleResults.filter(r => r.passed).length,
      criticalFails,
      warningFails,
      totalPenalty,
    },
    phase1Override: config.deployMode === 'draft' && route !== 'exception',
  };

  await audit.logServiceCall(
    correlationId, 'L4', 'score_calculate',
    { ruleCount: ruleResults.length, failedCount: failed.length },
    { score, route: effectiveRoute, naturalRoute: route },
    0, null
  );

  return result;
}

module.exports = { calculate };
