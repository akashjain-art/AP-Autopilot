// src/infra/cache/redis.js — Redis cache with warm-on-start and staleness tracking
const Redis = require('ioredis');
const config = require('../../../config');

let client = null;

function getClient() {
  if (!client) {
    client = new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 10) return null;
        return Math.min(times * 200, 5000);
      },
      lazyConnect: true,
    });
    client.on('error', (err) => console.error('[REDIS] Error:', err.message));
    client.on('connect', () => console.log('[REDIS] Connected'));
  }
  return client;
}

async function connect() {
  const c = getClient();
  await c.connect();
  return c;
}

// ── Cache operations with namespace prefixes ──

async function get(key) {
  const val = await getClient().get(key);
  return val ? JSON.parse(val) : null;
}

async function set(key, value, ttlSeconds) {
  const c = getClient();
  if (ttlSeconds) {
    await c.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } else {
    await c.set(key, JSON.stringify(value));
  }
}

async function del(key) {
  await getClient().del(key);
}

// ── Rules cache (15-min refresh from Google Sheets) ──

const RULES_PREFIX = 'rules:';
const RULES_VERSION_KEY = 'rules:_version';
const RULES_LAST_REFRESH_KEY = 'rules:_last_refresh';
const MERCHANT_MAP_KEY = 'rules:cc_merchant_map';

async function setRules(tabName, rules) {
  await set(`${RULES_PREFIX}${tabName}`, rules);
}

async function getRules(tabName) {
  return await get(`${RULES_PREFIX}${tabName}`);
}

async function setAllRules(rulesByTab, version) {
  const c = getClient();
  const pipeline = c.pipeline();
  for (const [tab, rules] of Object.entries(rulesByTab)) {
    pipeline.set(`${RULES_PREFIX}${tab}`, JSON.stringify(rules));
  }
  pipeline.set(RULES_VERSION_KEY, version);
  pipeline.set(RULES_LAST_REFRESH_KEY, new Date().toISOString());
  await pipeline.exec();
}

async function getRulesVersion() {
  return await getClient().get(RULES_VERSION_KEY);
}

async function getLastRefresh() {
  return await getClient().get(RULES_LAST_REFRESH_KEY);
}

async function getMerchantMap() {
  return await get(MERCHANT_MAP_KEY);
}

async function setMerchantMap(patterns) {
  await set(MERCHANT_MAP_KEY, patterns);
}

// ── Staleness check (R05 mitigation) ──

async function checkStaleness() {
  const lastRefresh = await getLastRefresh();
  if (!lastRefresh) return { stale: true, reason: 'never_refreshed', lastRefresh: null };

  const minutesSince = (Date.now() - new Date(lastRefresh).getTime()) / 60000;
  const staleThreshold = config.redis.stalenessAlertMinutes;

  return {
    stale: minutesSince > staleThreshold,
    minutesSinceRefresh: Math.round(minutesSince),
    threshold: staleThreshold,
    lastRefresh,
  };
}

// ── Warm-on-start check (R06 mitigation) ──

async function isCacheWarm() {
  const version = await getRulesVersion();
  return !!version;
}

// ── Health check ──

async function healthCheck() {
  try {
    const c = getClient();
    await c.ping();
    const staleness = await checkStaleness();
    return { healthy: true, stale: staleness.stale, ...staleness };
  } catch (err) {
    return { healthy: false, error: err.message };
  }
}

async function disconnect() {
  if (client) {
    await client.quit();
    client = null;
  }
}

module.exports = {
  connect, get, set, del,
  setRules, getRules, setAllRules, getRulesVersion,
  getLastRefresh, checkStaleness, isCacheWarm,
  getMerchantMap, setMerchantMap,
  healthCheck, disconnect, getClient,
};
