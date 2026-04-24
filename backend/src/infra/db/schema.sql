-- src/infra/db/schema.sql
-- Wiom Finance Autopilot V9 — PostgreSQL schema
-- Run with: node src/infra/db/migrate.js

-- ═══════════════════════════════════════════════════════════════
-- BILL LIFECYCLE — tracks every bill through the pipeline
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bill_lifecycle (
  id                SERIAL PRIMARY KEY,
  correlation_id    VARCHAR(100) NOT NULL UNIQUE,
  source            VARCHAR(10) NOT NULL CHECK (source IN ('zoho', 'cc')),
  
  -- Source identifiers
  invoice_number    VARCHAR(100),
  vendor_id         VARCHAR(50),
  vendor_name       VARCHAR(255),
  merchant_string   VARCHAR(500),          -- CC only: raw merchant from statement
  
  -- Amounts
  amount            DECIMAL(12,2),
  currency          VARCHAR(3) DEFAULT 'INR',
  
  -- Pipeline state
  current_step      SMALLINT DEFAULT 1,     -- 1-12 (zoho) or 1-13 (cc)
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','validated','approval_pending',
                                      'approved','posting','posted','proof_checked',
                                      'exception','failed','voided','skipped')),
  deploy_mode       VARCHAR(5) NOT NULL DEFAULT 'draft'
                    CHECK (deploy_mode IN ('draft','live')),
  
  -- Validation results
  score             SMALLINT,               -- 0-100 (null for CC)
  score_route       VARCHAR(20),            -- 'auto' / 'approval' / 'exception' / null
  failed_rules      JSONB DEFAULT '[]',
  failed_queues     VARCHAR(10)[] DEFAULT '{}',
  
  -- Zoho references (populated after posting)
  zoho_bill_id      VARCHAR(50),
  zoho_journal_id   VARCHAR(50),           -- CC only
  zoho_payment_id   VARCHAR(50),           -- CC only (settlement)
  
  -- Matching metadata (CC)
  match_method      VARCHAR(20),            -- exact/contains/fuzzy/none
  card_last4        VARCHAR(4),
  is_bank_charge    BOOLEAN DEFAULT FALSE,
  rcm_applied       BOOLEAN DEFAULT FALSE,
  gl_account        VARCHAR(100),
  gl_rule           VARCHAR(10),
  
  -- Timestamps
  entered_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validated_at      TIMESTAMPTZ,
  approved_at       TIMESTAMPTZ,
  posted_at         TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- R02 mitigation: prevent duplicate posting
-- Unique constraint on (source, invoice_number, vendor_id) for non-voided bills
CREATE UNIQUE INDEX IF NOT EXISTS idx_bill_dedup
  ON bill_lifecycle (source, invoice_number, vendor_id)
  WHERE status NOT IN ('voided', 'skipped');

-- CC dedup: same merchant + amount + date
CREATE INDEX IF NOT EXISTS idx_cc_dedup
  ON bill_lifecycle (merchant_string, amount, entered_at)
  WHERE source = 'cc' AND status NOT IN ('voided', 'skipped');

-- Pipeline state queries
CREATE INDEX IF NOT EXISTS idx_bill_status ON bill_lifecycle (status);
CREATE INDEX IF NOT EXISTS idx_bill_source_status ON bill_lifecycle (source, status);
CREATE INDEX IF NOT EXISTS idx_bill_correlation ON bill_lifecycle (correlation_id);

-- ═══════════════════════════════════════════════════════════════
-- AUDIT EVENTS — every decision logged with correlation ID
-- R10 mitigation: full audit trail reconstruction
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS audit_events (
  id                BIGSERIAL PRIMARY KEY,
  correlation_id    VARCHAR(100) NOT NULL,
  event_type        VARCHAR(50) NOT NULL,   -- 'rule_check', 'vendor_lookup', 'gl_classify', 'zoho_post', etc.
  agent             VARCHAR(20) NOT NULL,   -- 'A1', 'L4', 'L5', 'L7', 'A3', 'A4', 'system'
  rule_id           VARCHAR(20),            -- GST-001, TDS-005, etc. (null for non-rule events)
  
  input_snapshot    JSONB,                  -- what went in
  output_snapshot   JSONB,                  -- what came out
  
  passed            BOOLEAN,                -- true/false for rule checks
  severity          VARCHAR(10),            -- critical/warning/info
  penalty           SMALLINT DEFAULT 0,
  queue_bucket      VARCHAR(5),             -- Q1-Q8 (null if passed)
  
  duration_ms       INTEGER,                -- how long the operation took
  error_message     TEXT,                   -- if operation failed
  
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit_events (correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_events (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_rule ON audit_events (rule_id) WHERE rule_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events (created_at);

-- ═══════════════════════════════════════════════════════════════
-- EXCEPTIONS — queue state with SLA tracking
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS exceptions (
  id                SERIAL PRIMARY KEY,
  correlation_id    VARCHAR(100) NOT NULL,
  bill_lifecycle_id INTEGER REFERENCES bill_lifecycle(id),
  
  queue_bucket      VARCHAR(5) NOT NULL,    -- Q1-Q8
  owner             VARCHAR(50) NOT NULL,
  sla               VARCHAR(10) NOT NULL,
  
  rule_failures     JSONB NOT NULL,         -- array of { rule_id, severity, detail }
  failure_summary   TEXT,                   -- human-readable explanation
  
  status            VARCHAR(20) NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','in_progress','resolved','auto_resolved','escalated')),
  
  assigned_to       VARCHAR(100),
  resolution_notes  TEXT,
  
  -- SLA tracking
  sla_deadline      TIMESTAMPTZ,
  escalated_at      TIMESTAMPTZ,
  escalation_level  SMALLINT DEFAULT 0,     -- 0=none, 1=reminder, 2=L2, 3=CFO
  
  -- Recheck tracking
  last_recheck_at   TIMESTAMPTZ,
  recheck_count     INTEGER DEFAULT 0,
  next_recheck_at   TIMESTAMPTZ,
  
  -- Slack/notification
  slack_thread_ts   VARCHAR(50),
  last_notified_at  TIMESTAMPTZ,
  
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exception_queue ON exceptions (queue_bucket, status);
CREATE INDEX IF NOT EXISTS idx_exception_correlation ON exceptions (correlation_id);
CREATE INDEX IF NOT EXISTS idx_exception_recheck ON exceptions (next_recheck_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_exception_sla ON exceptions (sla_deadline) WHERE status IN ('open', 'in_progress');

-- ═══════════════════════════════════════════════════════════════
-- RULE CHANGE LOG — tracks changes to rules (R12 mitigation)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS rule_change_log (
  id                SERIAL PRIMARY KEY,
  rule_id           VARCHAR(20) NOT NULL,
  field_changed     VARCHAR(50) NOT NULL,
  old_value         TEXT,
  new_value         TEXT,
  is_critical       BOOLEAN DEFAULT FALSE,  -- severity, penalty, condition changes
  detected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at        TIMESTAMPTZ,            -- null if in cool-off period
  rules_version     VARCHAR(64)             -- hash of full ruleset at time of change
);

CREATE INDEX IF NOT EXISTS idx_rule_change_detected ON rule_change_log (detected_at);

-- ═══════════════════════════════════════════════════════════════
-- BATCH TRACKING — CC batch processing progress (R07)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS batch_tracking (
  id                SERIAL PRIMARY KEY,
  batch_id          VARCHAR(50) NOT NULL UNIQUE,
  source            VARCHAR(10) NOT NULL DEFAULT 'cc',
  total_items       INTEGER NOT NULL,
  processed         INTEGER DEFAULT 0,
  failed            INTEGER DEFAULT 0,
  skipped           INTEGER DEFAULT 0,
  remaining         INTEGER,
  status            VARCHAR(20) DEFAULT 'processing'
                    CHECK (status IN ('processing','paused','completed','failed')),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  error_summary     JSONB
);

-- ═══════════════════════════════════════════════════════════════
-- SYSTEM STATE — health check, token state, cache state
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS system_state (
  key               VARCHAR(50) PRIMARY KEY,
  value             JSONB NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Initialize system state
INSERT INTO system_state (key, value) VALUES
  ('deploy_mode', '"draft"'),
  ('zoho_auth', '{"status": "unknown", "last_check": null}'),
  ('rules_cache', '{"status": "cold", "last_refresh": null, "version": null}'),
  ('pipeline_status', '"running"')
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- AUTO-UPDATE timestamps trigger
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER bill_lifecycle_updated
  BEFORE UPDATE ON bill_lifecycle
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE OR REPLACE TRIGGER exceptions_updated
  BEFORE UPDATE ON exceptions
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();
