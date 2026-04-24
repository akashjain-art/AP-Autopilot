# Wiom AP Autopilot V9

**Finance AP automation system — Omnia Information Private Limited (Wiom)**

## Repository structure

```
wiom-ap-dashboard/        ← this repo
├── src/                  ← Frontend (React + Vite)
│   ├── App.jsx           ← Main dashboard (Connections, Vendors, Bills, Notifier tabs)
│   └── main.jsx
├── backend/              ← Backend Node.js (Railway services)
│   ├── config/           ← Zoho org IDs, queue config, env
│   ├── src/
│   │   ├── orchestrators/
│   │   │   ├── zoho-invoice/   ← 12-step Zoho vendor invoice flow
│   │   │   └── cc-transaction/ ← 13-step HSBC CC flow
│   │   ├── services/
│   │   │   ├── zoho-poster/    ← ZH-1/2/3 hard rules enforced here
│   │   │   ├── score-calculator/
│   │   │   ├── gl-classifier/
│   │   │   ├── rcm-engine/
│   │   │   ├── duplicate-checker/
│   │   │   ├── exception-router/
│   │   │   ├── proof-checker/
│   │   │   ├── vendor/
│   │   │   ├── notification/
│   │   │   └── audit-logger/
│   │   ├── rules/         ← Google Sheet rule engine (93 rules)
│   │   └── infra/         ← DB pool, Redis cache, cron jobs
│   └── test/              ← 92/92 tests passing
├── docs/
│   ├── Wiom_Finance_Autopilot_V9.docx   ← Architecture document
│   └── Wiom_AP_Rules_Engine_V2.xlsx     ← 93 rules, 15 tabs
├── index.html
├── package.json
├── vite.config.js
├── railway.json           ← Railway deploy config (frontend)
└── nixpacks.toml

```

## Zoho Hard Rules (non-negotiable)
- **ZH-1**: NO deletion of anything in Zoho — no delete API calls ever
- **ZH-2**: NO update of any posted entry — posted bills/journals are immutable
- **ZH-3**: NO direct live posting — all entries saved as DRAFT only. FC manually posts after review

All three rules are enforced in `backend/src/services/zoho-poster/index.js`

## Deploy mode
- **Phase 1 (current)**: `DEPLOY_MODE=draft` — all entries go to exception queue for QA
- **Phase 2**: FC signs off → flip to `DEPLOY_MODE=live`

## Railway env vars required
```
ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN
GOOGLE_SERVICE_ACCOUNT_KEY (JSON)
RULES_SHEET_ID=1xGH3kJ8xKKgeymVMZ7Qzbbc9QX0kBLzC4KUlp8_kEzY
SLACK_BOT_TOKEN
DATABASE_URL (auto from Railway PostgreSQL)
REDIS_URL (auto from Railway Redis)
DEPLOY_MODE=draft
```

## Test suite
```bash
cd backend && npm install && node test/run-tests.js
# Expected: 92/92 passed
```
