// src/infra/db/migrate.js — Run database migrations
const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

async function migrate() {
  console.log('[MIGRATE] Running schema migration...');
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  try {
    await pool.query(sql);
    console.log('[MIGRATE] Schema applied successfully');

    const tables = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `);
    console.log('[MIGRATE] Tables:', tables.rows.map(r => r.table_name).join(', '));
  } catch (err) {
    console.error('[MIGRATE] Failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) migrate();
module.exports = { migrate };
