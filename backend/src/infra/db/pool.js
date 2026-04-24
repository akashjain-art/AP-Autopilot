// src/infra/db/pool.js — PostgreSQL connection pool
const { Pool } = require('pg');
const config = require('../../../config');

const pool = new Pool({
  connectionString: config.database.url,
  ...config.database.pool,
  ssl: config.env === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 1000) {
    console.warn(`[DB] Slow query (${duration}ms): ${text.substring(0, 80)}`);
  }
  return result;
}

async function healthCheck() {
  try {
    const res = await pool.query('SELECT NOW() as time');
    return { healthy: true, time: res.rows[0].time, pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } };
  } catch (err) {
    return { healthy: false, error: err.message };
  }
}

module.exports = { pool, query, healthCheck };
