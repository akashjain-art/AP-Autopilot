// src/services/gl-classifier/index.js — GL account classification
// Zoho: HSN/SAC code → GL account (from GL Mapping tab)
// CC: merchant + description keywords → GL account
// Restaurant override: Swiggy/Zomato/food → Staff Welfare (GL-016)
// GL-015: cannot determine → SUSPENSE (agent must NOT guess)

const cache = require('../../infra/cache/redis');
const audit = require('../audit-logger');
const config = require('../../../config');

const RESTAURANT_KEYWORDS = ['swiggy', 'zomato', 'restaurant', 'food', 'lunch', 'dinner', 'cafe', 'dominos', 'mcdonald', 'starbucks', 'pizza', 'burger'];

async function classify({ text, sourceType, hsnSac, glOverride, correlationId }) {
  const start = Date.now();
  let result;

  // Priority 1: GL override from merchant map (CC transactions with specific GL)
  if (glOverride) {
    result = {
      glRule: 'OVERRIDE',
      glAccount: glOverride,
      sacCode: '',
      isManual: false,
      isRestaurant: RESTAURANT_KEYWORDS.some(k => glOverride.toLowerCase().includes(k) || (text || '').toLowerCase().includes(k)),
      glOverride,
    };
  }
  // Priority 2: Restaurant detection for CC (overrides keyword matching)
  else if (sourceType === 'cc' && text && RESTAURANT_KEYWORDS.some(k => text.toLowerCase().includes(k))) {
    result = {
      glRule: 'GL-016',
      glAccount: 'Staff Welfare',
      sacCode: '996331',
      isManual: false,
      isRestaurant: true,
      glOverride: null,
    };
  }
  // Priority 3: HSN/SAC lookup (Zoho invoices with HSN code)
  else if (hsnSac) {
    result = await classifyByHSN(hsnSac);
  }
  // Priority 4: Keyword matching from description
  else if (text) {
    result = await classifyByKeyword(text);
  }
  // Fallback: GL-015 suspense
  else {
    result = suspenseResult('No text or HSN provided');
  }

  await audit.logServiceCall(
    correlationId, sourceType === 'cc' ? 'L4' : 'L4',
    'gl_classify',
    { text: (text || '').substring(0, 100), sourceType, hsnSac },
    result,
    Date.now() - start,
    result.isManual ? 'GL-015: manual classification needed' : null
  );

  return result;
}

async function classifyByHSN(hsnSac) {
  const glRules = await cache.getRules('GL Mapping') || [];
  // Each GL rule has notes containing SAC code like "SAC 998314"
  // Match by checking if the rule's notes or condition_value contains the HSN
  for (const rule of glRules) {
    const notes = (rule.notes || '').toLowerCase();
    const condValue = (rule.condition_value || '').toLowerCase();
    if (notes.includes(hsnSac) || condValue.includes(hsnSac)) {
      const accountMatch = (rule.notes || '').match(/→\s*(.+?)(?:\s*\(|$)/);
      return {
        glRule: rule.rule_id,
        glAccount: accountMatch ? accountMatch[1].trim() : rule.name,
        sacCode: hsnSac,
        isManual: false,
        isRestaurant: false,
        glOverride: null,
      };
    }
  }
  return suspenseResult(`HSN/SAC ${hsnSac} not found in GL mapping`);
}

async function classifyByKeyword(text) {
  const glRules = await cache.getRules('GL Mapping') || [];
  const textLower = text.toLowerCase();

  for (const rule of glRules) {
    if (rule.rule_id === 'GL-015' || rule.rule_id === 'GL-016') continue; // skip fallback + restaurant
    const condValue = (rule.condition_value || '').toLowerCase();
    // Extract keywords from condition_value: "LOWER(desc) CONTAINS ANY ['software','saas',...]"
    const keywordMatch = condValue.match(/\[([^\]]+)\]/);
    if (keywordMatch) {
      const keywords = keywordMatch[1].split(',').map(k => k.trim().replace(/['"]/g, ''));
      if (keywords.some(k => textLower.includes(k))) {
        const accountMatch = (rule.notes || '').match(/→\s*(.+?)(?:\s*\(|$)/);
        const sacMatch = (rule.notes || '').match(/SAC\s*(\d+)/i);
        return {
          glRule: rule.rule_id,
          glAccount: accountMatch ? accountMatch[1].trim() : rule.name,
          sacCode: sacMatch ? sacMatch[1] : '',
          isManual: false,
          isRestaurant: false,
          glOverride: null,
        };
      }
    }
  }
  return suspenseResult(`No keyword match in "${text.substring(0, 50)}"`);
}

function suspenseResult(reason) {
  return {
    glRule: 'GL-015',
    glAccount: 'Suspense',
    sacCode: '',
    isManual: true,
    isRestaurant: false,
    glOverride: null,
    note: `MANUAL: ${reason}. Zoho account: ${config.zohoIds.suspenseAccount}`,
  };
}

module.exports = { classify };
