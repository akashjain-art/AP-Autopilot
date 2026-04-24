# Wiom Finance Autopilot V9

AP automation: source-specific orchestrators + shared validation services.

## Architecture

```
src/
  orchestrators/
    zoho-invoice/        ← Agent 3: 12-step invoice flow
    cc-transaction/      ← Agent 4: 13-step CC flow
  services/
    vendor/              ← Agent 2: lookup, match, verify, bank detect
    gl-classifier/       ← Agent 2: keyword → GL, HSN lookup, restaurant override
    rcm-engine/          ← Agent 2: multi-signal overseas RCM detection
    duplicate-checker/   ← Agent 2: exact, fuzzy, cross-vendor
    score-calculator/    ← Agent 2: penalty sum → 0-100 score
    exception-router/    ← Agent 2: Q1-Q8 routing + Slack + SLA
    zoho-poster/         ← Agent 3: bill, journal, payment API + idempotency
    proof-checker/       ← Agent 3: 7-field post-posting verification
    notification/        ← Agent 4: Slack DM, email, escalation chain
    audit-logger/        ← Agent 1: ✅ DONE — correlation ID + PostgreSQL
    contracts.js         ← ✅ DONE — input/output types for all services
  rules/
    sheet-reader.js      ← Agent 1: ✅ DONE — Google Sheets → Redis cache
    rule-executor.js     ← Agent 1: ✅ DONE — run rules by stage + source
  infra/
    db/
      schema.sql         ← Agent 1: ✅ DONE — all PostgreSQL tables
      pool.js            ← Agent 1: ✅ DONE — connection pool
      migrate.js         ← Agent 1: ✅ DONE — migration runner
    cache/
      redis.js           ← Agent 1: ✅ DONE — warm-on-start + staleness
    cron/                ← Stubs in index.js, agents implement handlers
  index.js               ← Agent 1: ✅ DONE — startup + health + crons
config/
  index.js               ← Agent 1: ✅ DONE — all env config
```

## Agent assignments

### Agent 1: Foundation (DONE)
- [x] PostgreSQL schema (bill_lifecycle, audit_events, exceptions, rule_change_log, batch_tracking)
- [x] Redis cache with warm-on-start and staleness detection
- [x] Rules engine reader (Google Sheets API, version hash, diff tracking)
- [x] Rule executor (by stage, source filter, execution order, dependencies)
- [x] Audit logger (correlation ID threading)
- [x] Service contracts (input/output types for all 10 services)
- [x] Main entry point (startup sequence, health checks, cron stubs)
- [x] Config (all Railway env vars)
- [x] Railway deployment config

### Agent 2: Shared services (DONE)
- [x] Vendor service — Zoho lookup + CC 4-step merchant matching (exact/contains/fuzzy/Q3)
- [x] GL classifier — HSN lookup + keyword matching + restaurant override (GL-016)
- [x] RCM engine — multi-signal overseas detection (R08): GSTIN + currency + country + place of supply
- [x] Duplicate checker — exact + fuzzy (fuse.js) + cross-vendor + CC duplicate
- [x] Score calculator — penalty sum + route (auto/approval/exception) + Phase 1 override
- [x] Exception router — Q1-Q8 routing + PostgreSQL records + Slack alerts + SLA + escalation + recheck

### Agent 3: Zoho pipeline (DONE)
- [x] Zoho OAuth + health probe (R04) — proactive refresh at T-10min, 5-min health check
- [x] Zoho poster — bill/journal/payment API, idempotency keys (R02), rate limiter (bottleneck), void for saga compensation
- [x] Zoho orchestrator — 12-step flow wiring all shared services
- [x] PDF extractor — field extraction via pdf-parse, GSTIN/HSN/amount/date regex, confidence scoring
- [x] Document classifier (L1.5) — type detection in PDF extractor (tax_invoice/proforma/estimate/etc)
- [x] Proof checker — 7-field post-posting verification + CC 3-entry verification
- [x] Master validator — 8 final gate checks (MV-001 to MV-008) with PostgreSQL dependency checks

### Agent 4: CC pipeline (DONE)
- [x] Saga coordinator — 3-step atomicity with compensation (R01): bill → journal → settlement
- [x] CC orchestrator — 13-step flow with skip rules, bank detect, all shared services wired
- [x] CC batch processing — sequential with batch_tracking in PostgreSQL
- [x] Notification engine — Slack DM + channel posts, approval requests, reminders, escalations, digest
- [x] A4 follow-up agent — 12h cycle, pending approval scan, SLA escalation, digest generation
- [x] All cron jobs wired — rules refresh, staggered rechecks, follow-up, escalation, Zoho health

## Setup

```bash
# Install dependencies
npm install

# Set Railway env vars:
# DATABASE_URL, REDIS_URL, ZOHO_ORG_ID, ZOHO_CLIENT_ID,
# ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, GOOGLE_SERVICE_ACCOUNT_KEY,
# RULES_SHEET_ID, SLACK_BOT_TOKEN, DEPLOY_MODE=draft

# Run migrations
npm run migrate

# Start
npm start
```

## Risk mitigations built into foundation
- R02: Unique constraint on (source, invoice_number, vendor_id) prevents duplicate posting
- R05: Version hash reduces Google Sheets API calls by ~90%
- R06: Warm-on-start blocks startup until rules loaded from cache or sheet
- R10: Correlation ID generated at pipeline entry, threaded through all services
- R12: Rule change diff detection on every cache refresh, logged to PostgreSQL
