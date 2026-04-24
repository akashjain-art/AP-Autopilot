const fs = require("fs");
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageBreak, LevelFormat, PageNumber, TabStopType, PositionalTab,
  PositionalTabAlignment, PositionalTabRelativeTo, PositionalTabLeader } = require("docx");

const B = (t, opts={}) => new TextRun({ text: t, bold: true, font: "Arial", size: 22, ...opts });
const T = (t, opts={}) => new TextRun({ text: t, font: "Arial", size: 22, ...opts });
const M = (t, opts={}) => new TextRun({ text: t, font: "Consolas", size: 20, ...opts });
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [B(t, { size: 32 })], spacing: { before: 400, after: 200 } });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [B(t, { size: 28 })], spacing: { before: 300, after: 150 } });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [B(t, { size: 24 })], spacing: { before: 200, after: 100 } });
const P = (...runs) => new Paragraph({ children: runs, spacing: { after: 120 }, indent: { left: 0 } });
const PI = (t) => new Paragraph({ children: [T(t, { italics: true, color: "666666" })], spacing: { after: 100 } });
const NL = () => new Paragraph({ spacing: { after: 60 } });

const bd = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: bd, bottom: bd, left: bd, right: bd };
const hdrShade = { fill: "1a2236", type: ShadingType.CLEAR };
const hdrFont = { bold: true, font: "Arial", size: 20, color: "FFFFFF" };
const altShade = { fill: "F5F7FA", type: ShadingType.CLEAR };
const newShade = { fill: "E3F2FD", type: ShadingType.CLEAR };
const warnShade = { fill: "FFF3E0", type: ShadingType.CLEAR };
const dangerShade = { fill: "FFEBEE", type: ShadingType.CLEAR };
const successShade = { fill: "E8F5E9", type: ShadingType.CLEAR };
const cellM = { top: 60, bottom: 60, left: 100, right: 100 };

function makeRow(cells, shade, isHeader=false) {
  return new TableRow({ children: cells.map((c, i) => new TableCell({
    borders, margins: cellM,
    shading: shade || (undefined),
    width: { size: c.w || 2000, type: WidthType.DXA },
    children: [new Paragraph({ children: [isHeader ? new TextRun({ text: c.t, ...hdrFont }) : (c.mono ? M(c.t) : T(c.t, c.opts || {}))] })]
  })) });
}

function simpleTable(headers, rows, colWidths) {
  const tw = colWidths.reduce((s,w)=>s+w, 0);
  const hRow = makeRow(headers.map((h,i) => ({ t: h, w: colWidths[i] })), hdrShade, true);
  const dRows = rows.map((r, ri) => makeRow(r.map((c, ci) => {
    if (typeof c === 'string') return { t: c, w: colWidths[ci] };
    return { ...c, w: colWidths[ci] };
  }), ri % 2 === 1 ? altShade : undefined));
  return new Table({ width: { size: tw, type: WidthType.DXA }, columnWidths: colWidths, rows: [hRow, ...dRows] });
}

// ═══════════════════════════════════════════════════════════════════
// BUILD DOCUMENT
// ═══════════════════════════════════════════════════════════════════
const children = [];

// ─── Title page ──────────────────────────────────────────────────
children.push(NL(), NL(), NL(), NL());
children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [T("Wiom Finance Autopilot  |  V9", { italics: true, size: 24, color: "888888" })] }));
children.push(NL());
children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [B("WIOM FINANCE AUTOPILOT", { size: 44 })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [T("Architecture & Scoping Document", { size: 28 })] }));
children.push(NL());
children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [T("Omnia Information Private Limited (Wiom)", { size: 22, color: "666666" })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [T("April 21, 2026  |  Version 9.0 (with CC Merchant Matching)", { size: 22, color: "666666" })] }));
children.push(NL());
children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [B("CONFIDENTIAL", { size: 22, color: "C62828" })] }));
children.push(NL(), NL());
children.push(PI("V9 changes from V8: Replaced single-pipeline model with source-specific orchestrators + shared services. Added full CC transaction pipeline with 4-step merchant matching (pattern table + fuzzy suggestions). Added risk register with 14 mitigations. Restructured rules engine (V2 sheet with 93 rules across 15 tabs, including CC Merchant Map with 45 pre-populated vendor patterns). Fixed bank charge treatment, duplicate rules, and missing CC/Master Validator rules."));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ═══════════════════════════════════════════════════════════════════
// PART 1: ARCHITECTURE OVERVIEW
// ═══════════════════════════════════════════════════════════════════
children.push(H1("Part 1: Architecture overview"));
PI("This section shows how the entire system fits together. V9 introduces source-specific orchestrators calling shared services — replacing the single-pipeline model from V8.");

// 1.1 What we are building
children.push(H2("1.1  What we are building"));
children.push(P(T("A completely new AP automation system (not an enhancement of existing apps). The system validates every bill through "), B("89 rules"), T(" before any human sees it, routes genuine bills to business users for approval, and posts to Zoho Books only after sign-off.")));
children.push(NL());
children.push(P(B("Three principles govern the design:")));
children.push(P(B("1. System owns compliance. "), T("GST, TDS, RCM, vendor verification, duplicate detection. No human checks compliance.")));
children.push(P(B("2. Business user owns genuineness. "), T("Is this bill real? Was this service actually rendered? No system guesses business intent.")));
children.push(P(B("3. Draft-first deployment. "), T("Phase 1: no live posting — all entries go to draft/QA mode. Phase 2: live posting only after FC sign-off.")));
children.push(NL());

children.push(H2("1.1a  Zoho Books — three immutable system rules"));
children.push(PI("These three rules are hard-coded into the system architecture and cannot be overridden by any configuration, user action, or code change. They protect the integrity of Zoho Books as the accounting source of truth."));
children.push(NL());
children.push(P(B("RULE ZH-1 — NO DELETION. "), T("The system will never call any Zoho Books delete API endpoint. No bill, journal entry, contact, payment, or any other record will ever be deleted by the AP Autopilot system. If a record needs to be removed, a human must do it manually in Zoho Books with a logged reason. The delete_bill, delete_contact, delete_invoice, and all similar delete endpoints are permanently prohibited in the codebase.")));
children.push(NL());
children.push(P(B("RULE ZH-2 — NO UPDATE OF POSTED ENTRIES. "), T("Once a bill or journal entry has been posted (status = open/approved in Zoho Books), it is immutable. The system will never call update APIs on posted records. Posted accounting entries form the permanent financial record. To correct a posted entry, a human must void it and re-enter in Zoho Books directly. The portal's 'Edit Zoho Entry' tab is disabled (read-only) for all posted bills — this is enforced in the UI and in the API layer.")));
children.push(NL());
children.push(P(B("RULE ZH-3 — DRAFT ONLY, NO DIRECT POSTING. "), T("The AP Autopilot system will never submit or approve entries in Zoho Books. All bills and journal entries are saved as DRAFT status only. The Finance Controller (Akash) must open Zoho Books directly, review each draft, and post it manually. The system has no 'post' button, no 'approve' API call, and no pathway to move a bill from draft to open/posted status. This rule applies in both Phase 1 and Phase 2 — the 'Phase 2 live posting' referenced elsewhere means the FC has approved the QA results and the system is creating drafts at scale, not that the system itself posts them.")));
children.push(NL());
children.push(PI("These rules are documented in: (1) architecture document (this section), (2) codebase — zoho-poster.js has a hard guard that rejects any call with action=delete or status != draft, (3) Claude's memory for persistent enforcement across all future development sessions."));

// 1.2 Architecture model
children.push(H2("1.2  Architecture model: orchestrators + shared services"));
children.push(PI("V8 had one pipeline (7 layers, 4 agents) that both Zoho invoices and CC transactions shared. V9 splits into source-specific orchestrators that call shared validation services. The 7-layer model remains as the conceptual framework, but execution is now source-aware."));
children.push(NL());
children.push(P(B("Why the change: "), T("Zoho invoices and CC transactions are structurally different objects. Forcing them through one pipeline created 5 out of 8 layers having CC-specific exceptions — that is not one pipeline, it is two pipelines pretending to be one.")));
children.push(NL());
children.push(P(B("The new model:")));
children.push(P(T("Source-specific orchestrators (thin, disposable) → call shared validation services (thick, permanent). The orchestrator knows WHAT to call and in what ORDER. The service knows HOW to validate, match, or post.")));
children.push(NL());

children.push(simpleTable(
  ["Component", "Type", "Purpose"],
  [
    ["Zoho Invoice Orchestrator", "Source-specific", "12-step flow: document intake → classify → extract → validate → approve → post → verify"],
    ["CC Transaction Orchestrator", "Source-specific", "13-step flow: skip check → vendor match → GL map → card map → RCM → 3-entry pipeline → verify"],
    ["Future: Amazon/Wallet Orchestrator", "Source-specific", "Write one new orchestrator, same shared services. No core changes."],
    ["Future: Gmail Inbox Orchestrator", "Source-specific", "Email classifier + same shared services."],
    ["10 Shared Services", "Reusable", "Vendor, GL, RCM, Duplicate, Score, Exception, Zoho Poster, Proof-Check, Notification, Audit"],
  ],
  [2800, 1600, 4960]
));

// 1.3 Shared services
children.push(H2("1.3  The 10 shared services"));
children.push(P(T("Each service has a strict input/output contract. Orchestrators import services — services never import orchestrators. This dependency direction is what enables future service splitting.")));
children.push(NL());

children.push(simpleTable(
  ["Service", "What it does", "Called by", "Risk if duplicated"],
  [
    ["Vendor Service", "Lookup, match, verify active, GSTIN check, bank vendor detect", "Both", "Vendor created in Zoho but not synced to CC matcher → overseas vendor skips RCM"],
    ["GL Classifier", "Keyword → GL account + HSN/SAC. Restaurant override for CC.", "Both", "GL-006 updated in invoice pipeline but not CC → Google Ads CC charges go to suspense"],
    ["RCM Engine", "gst_treatment check → apply IGST RCM if overseas", "Both", "THE critical service. 36/289 overseas bills missed RCM. Duplication = same gap persists."],
    ["Duplicate Checker", "Exact + fuzzy + cross-vendor duplicate detection", "Both", "Different matching logic = inconsistent duplicate detection"],
    ["Score Calculator", "Sum penalties from rule results → 0-100 score", "Zoho only", "CC does not score (no business approval needed)"],
    ["Exception Router", "Route failures to Q1-Q8 with reports + Slack alerts", "Both", "Different report formats = Tushar sees two templates for same queue"],
    ["Zoho Poster", "Create bill, journal, apply payment via Zoho API", "Both", "Draft mode flag implemented differently = CC entries post live during Phase 1"],
    ["Proof Checker", "Re-read from Zoho API, compare fields vs input", "Both", "Different field sets checked = gaps in post-posting verification"],
    ["Notification Engine", "Slack DM, email, escalation chain, digests", "Both", "Inconsistent notification templates"],
    ["Audit Logger", "Every decision timestamped with correlation ID", "Everything", "Logs without correlation ID = auditor cannot reconstruct bill decisions"],
  ],
  [1600, 2800, 1000, 3960]
));

// 1.4 Score gate
children.push(H2("1.4  The score gate"));
children.push(P(T("Every Zoho invoice is scored 0-100 by the rule engine. CC transactions do NOT use the score gate — function head already approved the payment when they swiped the card.")));
children.push(NL());

children.push(simpleTable(
  ["Score", "What happens", "Who acts"],
  [
    ["90-100", "Zoho invoice: route to business user for genuineness check (approval required)", "Business user"],
    ["70-89", "Route to business user — verify: did we receive this service? Is the amount correct?", "Dept head"],
    ["0-69", "Route to exception queue bucket [Q1-Q8] with detailed failure report", "Accounts team"],
    ["CC bills", "Skip score gate entirely. Already paid at swipe. Go directly to 3-entry pipeline.", "System (no human)"],
  ],
  [1400, 5160, 2800]
));
children.push(NL());
children.push(P(B("PHASE 1 OVERRIDE: "), T("During Phase 1 (QA/draft mode), ALL bills go to exception route with detailed report regardless of score. No auto-posting until FC signs off.")));

// 1.5 Zoho invoice end to end
children.push(H2("1.5  Zoho invoice: end to end (12 steps)"));
children.push(simpleTable(
  ["Step", "What happens", "Agent/Service", "Rules tab"],
  [
    ["1", "Document uploaded via vendor portal → lands in document section", "L1", "—"],
    ["2", "Agent classifies: tax invoice → create bill. Non-invoice → park in review folder", "L1.5", "—"],
    ["3", "PDF extract + OCR: vendor name, GSTIN, invoice#, amount, HSN, dates", "A1 (orchestrator)", "Document Rules"],
    ["4", "Vendor verify: exists in Zoho, active, GSTIN match, buyer GSTIN, PAN", "Vendor Service", "Vendor Rules"],
    ["5", "Duplicate check: exact invoice# + vendor, fuzzy match, cross-vendor", "Duplicate Checker", "Duplicate Rules"],
    ["6", "GST validation: place of supply, rate vs HSN, RCM for overseas", "RCM Engine", "GST Rules"],
    ["7", "TDS validation: section, rate, threshold, Section 393 (post Apr 2026)", "A1 (orchestrator)", "TDS Rules"],
    ["8", "GL classify via HSN/SAC code → GL account mapping", "GL Classifier", "GL Mapping"],
    ["9", "Score calculate → route: 90+ / 70-89 / <70 / exception", "Score Calculator + Exception Router", "—"],
    ["10", "Business approval: genuineness check by dept head (Zoho invoices only)", "Notification Engine", "—"],
    ["11", "Create bill in Zoho Books in DRAFT (Phase 1) or live (Phase 2)", "Zoho Poster", "—"],
    ["12", "Proof-check: re-read from Zoho API, compare 7 fields vs original input", "Proof Checker", "Proof-Check Rules"],
  ],
  [600, 4200, 2200, 2360]
));

// 1.6 CC transaction end to end (NEW)
children.push(H2("1.6  CC transaction: end to end (13 steps)"));
children.push(PI("This section was missing from V8. CC transactions are raw debit lines from a card statement — merchant name, amount, date, card holder. No document, no GSTIN, no invoice number. Completely different pipeline from Zoho invoices."));
children.push(NL());
children.push(simpleTable(
  ["Step", "What happens", "Agent/Service", "Rules tab"],
  [
    ["1", "Receive row from HSBC Google Sheet (auto-updated via Postman)", "L1", "—"],
    ["2", "Controls check: IGST Assessment → Q5 (Saurav to confirm). Amount ≤ 0 (reversal) → Q5 (Tushar to match original). No silent skipping — every transaction visible to a human.", "CC Orchestrator", "CC-SKIP-01, CC-SKIP-02 → Q5"],
    ["3", "Merchant → vendor: 4-step match (exact → contains → fuzzy → Q3). See section 1.9.", "Vendor Service + CC Merchant Map", "CC-MATCH-01 to 04"],
    ["4", "Bank vendor detection: is_bank=true → flag for full 3-step treatment", "Vendor Service", "CC Pipeline Rules"],
    ["5", "GL classify via merchant keywords + description text", "GL Classifier", "GL Mapping"],
    ["6", "Restaurant detection: Swiggy/Zomato/food → override to Staff Welfare GL", "GL Classifier", "CC Pipeline Rules"],
    ["7", "Card holder mapping: last-4 digits → Zoho CC account ID", "CC Orchestrator", "CC Pipeline Rules"],
    ["8", "RCM check: overseas merchant → IGST 18% RCM (Tax ID: 2295010000001409879)", "RCM Engine", "CC Pipeline Rules"],
    ["9", "Duplicate check: same merchant + amount + date", "Duplicate Checker", "Duplicate Rules"],
    ["10", "Step 1 of 3: Create vendor bill with RCM if applicable", "Zoho Poster", "—"],
    ["11", "Step 2 of 3: Create CC journal entry (Dr vendor / Cr CC account)", "Zoho Poster", "—"],
    ["12", "Step 3 of 3: Settlement knock-off — match bill to journal (±₹0.02 tolerance)", "Zoho Poster", "CC Pipeline Rules"],
    ["13", "Proof-check: verify bill + journal + settlement against input", "Proof Checker", "Proof-Check Rules"],
  ],
  [600, 4200, 2000, 2560]
));
children.push(NL());
children.push(P(B("CC key differences from Zoho: "), T("No document classification (L1.5 skipped). No business approval. No score gate. 3-step atomic pipeline (bill + journal + settlement) with saga pattern for rollback. Bank charges (HSBC, HDFC, etc.) are NOT skipped — they get full 3-step treatment with bank vendor. IGST assessments and negative amounts (reversals) route to Q5 exception — no transaction is silently hidden from all humans (controls decision 2026-04-22).")));

// 1.7 Exception queues
children.push(H2("1.7  Exception queue buckets (8 queues)"));
children.push(P(T("Each team member sees ONLY their queues. When a bill fails at ANY layer, the system routes it to the correct bucket with a detailed explanation of WHY it was held. Auto-recheck runs every 1 HOUR (staggered per queue to prevent storms). Plus a manual 'run now' button for immediate recheck.")));
children.push(NL());
children.push(simpleTable(
  ["Queue", "Name", "Owner", "SLA", "Recheck at"],
  [
    ["Q1", "GST / RCM failures", "Saurav (Tax)", "24 hours", ":00"],
    ["Q2", "TDS section mismatch", "Saurav (Tax)", "24 hours", ":07"],
    ["Q3", "Vendor not found / inactive", "Tushar (AP)", "3 business days", ":15"],
    ["Q4", "Duplicate detected", "Mahesh (Review)", "Immediate", ":22"],
    ["Q5", "Amount mismatch (PDF vs Zoho)", "Tushar (AP)", "24 hours", ":30"],
    ["Q6", "Missing documents / wrong type", "Tushar (AP)", "48 hours", ":37"],
    ["Q7", "GL mapping unclear (GL-015 fired)", "Mahesh (Review)", "24 hours", ":45"],
    ["Q8", "Proof-check mismatch (post-posting)", "Tushar (AP)", "Immediate", ":52"],
  ],
  [700, 2400, 1800, 1600, 2860]
));

// 1.8 Rules engine
children.push(H2("1.8  Rules engine: Google Sheet V2 (93 rules, 15 tabs)"));
children.push(PI("V8 had 71 rules across 9 tabs with inconsistent IDs and missing CC/MV rules. V2 sheet adds 24 new rules, retires 2 duplicates, adds 6 new columns, and 6 new tabs (including CC Merchant Map and CC Match Config)."));
children.push(NL());

children.push(P(B("New columns added (V2):")));
children.push(simpleTable(
  ["Column", "Purpose", "Why it was missing"],
  [
    ["executed_by", "Which agent/layer runs this rule (A1 / L4 / L5 / L7 / A3)", "System couldn't tell which stage runs which rule"],
    ["execution_order", "Sequence within the stage (1, 2, 3...)", "No dependency ordering — rules ran in undefined order"],
    ["depends_on", "Prerequisite rule_id that must pass first", "Can't check GSTIN match if vendor doesn't exist"],
    ["effective_from", "Start date for regulatory rules (e.g., Section 393: 2026-04-01)", "No way to handle regulatory transitions"],
    ["effective_to", "Expiry date for sunsetting rules (e.g., old 194-series)", "Expired rules never cleaned up"],
    ["notes", "Implementation notes, known issues, historical context", "No context for dev team implementing rules"],
  ],
  [2000, 3800, 3560]
));
children.push(NL());
children.push(P(B("All 15 tabs:")));
children.push(simpleTable(
  ["Tab", "Rule count", "Stage", "Status"],
  [
    ["GST Rules", "5 (GST-001 to GST-005)", "L4", "From V8"],
    ["TDS Rules", "10 (TDS-001 to TDS-010)", "L4", "From V8"],
    ["Vendor Rules", "5 active + 1 retired (A1-030 to A1-042)", "A1", "A1-040 retired (dup of GST-004)"],
    ["GL Mapping", "16 (GL-001 to GL-016)", "L4", "GL-016 new (restaurant → Staff Welfare)"],
    ["Amount Rules", "6 (AMT-001 to AMT-006)", "A1 + L4", "From V8"],
    ["Document Rules", "11 active + 1 retired (A1-001 to DOC-001)", "A1", "A1-053 retired (dup of AMT-005)"],
    ["Duplicate Rules", "4 (A1-020 to DUP-001)", "A1", "From V8"],
    ["Proof-Check Rules", "7 (PC-001 to PC-007)", "L7", "From V8"],
    ["Prepaid Rules", "6 (PP-001 to PP-006)", "L4", "From V8"],
    ["CC Pipeline Rules", "13 (CC-SKIP to CC-MATCH-04)", "A1 + L4 + A3", "NEW in V9 — was 3 rules"],
    ["CC Merchant Map", "45 known patterns + template rows", "A1", "NEW in V9 — the matching reference table"],
    ["CC Match Config", "Matching rules, fuzzy settings, workflow", "A1", "NEW in V9 — configuration"],
    ["Master Validator", "8 (MV-001 to MV-008)", "L5", "NEW in V9"],
    ["Execution Map", "Summary: all stages, tabs, counts", "—", "NEW in V9"],
    ["Rule Status Dashboard", "All 93 rules tracked", "—", "Updated from V8"],
  ],
  [2400, 3200, 1400, 2360]
));
children.push(NL());
children.push(P(B("Duplicates retired: "), T("A1-040 (Buyer GSTIN) → use GST-004. A1-053 (Amount > 0) → use AMT-005. Retired rules stay in sheet with yellow highlight for audit trail.")));
children.push(P(B("Google Sheet V2 link: "), T("(to be uploaded — replaces V1 sheet)")));
children.push(P(B("Rule count: 71 → 93 "), T("(24 added, 2 retired, net 90 active rules across 15 tabs)")));

// ═══════════════════════════════════════════════════════════════════
// 1.9 CC Merchant Matching
// ═══════════════════════════════════════════════════════════════════
children.push(H2("1.9  CC merchant matching: pattern table + fuzzy suggestions"));
children.push(PI("A CC statement gives a raw merchant string like 'ZOHO CORPORATION CHENNAI'. The system must map this to a Zoho Books vendor. This section defines how that matching works, who maintains it, and what happens when no match is found."));
children.push(NL());

children.push(P(B("The problem: "), T("200+ vendors, but CC merchant strings are messy and inconsistent. 'ZOHO CORPORATION CHENNAI', 'ZOHO CORP PAYMENT', and 'ZOHO ONE RENEW' are all the same vendor. 'AMAZON WEB SERVICES' and 'AMAZON.IN MARKETPLACE' are different vendors. 'HDFC BANK' and 'HDFC ERGO' are different vendors. A keyword map alone breaks on these edge cases.")));
children.push(NL());

children.push(P(B("The solution: Option B (pattern table) + Option C (fuzzy suggestions)")));
children.push(NL());

children.push(H3("Matching table: CC Merchant Map tab (Google Sheet)"));
children.push(P(T("A configurable mapping table maintained by Tushar. Each row maps a merchant pattern to a Zoho vendor. System reads via Google Sheets API, cached in Redis alongside rules.")));
children.push(NL());

children.push(P(B("Table structure (16 columns):")));
children.push(simpleTable(
  ["Column", "Purpose", "Example"],
  [
    ["merchant_pattern", "The text to match against raw CC merchant string", "zoho, amazon web services, hdfc bank"],
    ["match_type", "How to match: exact, contains, regex", "contains (default for most patterns)"],
    ["zoho_vendor_id", "Mapped Zoho Books vendor ID", "VND-0041, VND-0015"],
    ["zoho_vendor_name", "Human-readable vendor name (reference)", "Zoho Corporation Pvt Ltd"],
    ["gst_treatment", "registered / overseas / unregistered", "overseas (triggers RCM check)"],
    ["is_bank", "Is this a bank vendor? yes/no", "yes for HSBC, HDFC Bank — triggers full 3-step"],
    ["gl_override", "Force a specific GL account (overrides GL classifier)", "Staff Welfare for restaurants"],
    ["gl_rule", "Which GL rule applies", "GL-001, GL-012, GL-016"],
    ["category", "Grouping for reporting", "Software/SaaS, Banking, Restaurant"],
    ["status", "confirmed / suggested / pending_review", "confirmed (Tushar validated)"],
    ["fuzzy_confidence", "If matched via fuzzy, what was the score", "85% (only for suggested matches)"],
    ["match_count", "How many times this pattern has matched (auto-updated)", "47 (helps identify high-traffic patterns)"],
    ["notes", "Conflict warnings, implementation notes", "CRITICAL: must NOT match amazon.in"],
  ],
  [2000, 3800, 3560]
));
children.push(NL());

children.push(P(B("Pre-populated: 45 known patterns across 10 categories:")));
children.push(simpleTable(
  ["Category", "Count", "Key patterns", "GL mapping"],
  [
    ["Software / SaaS", "7", "zoho, adobe, atlassian, github, slack, notion, zoho one", "GL-001 Subscription Charges"],
    ["Cloud / Hosting", "4", "amazon web services, aws, digitalocean, google cloud", "GL-002 Cloud Charges"],
    ["Advertising", "4", "google ads, meta ads, facebook, linkedin", "GL-006 Advert & Marketing"],
    ["Travel", "7", "uber, ola, makemytrip, cleartrip, indigo, air india, oyo", "GL-013 Travel Expenses"],
    ["Restaurant", "5", "swiggy, zomato, dominos, mcdonald, starbucks", "GL-016 → Staff Welfare (override)"],
    ["Logistics", "3", "delhivery, bluedart, dtdc", "GL-008 Logistic Charges"],
    ["Banking", "7", "hsbc, hdfc bank, icici bank, sbi, axis, kotak, razorpay", "GL-012 Finance Cost (is_bank=yes)"],
    ["Insurance", "1", "hdfc ergo", "GL-011 Employee Welfare (NOT a bank)"],
    ["Internet / Telecom", "3", "airtel, jio, act fibernet", "GL-003 ISP Expenses"],
    ["E-commerce", "2", "amazon.in, flipkart", "No GL override (varies by purchase)"],
    ["Office / Infrastructure", "2", "wework, regus", "GL-004 Infrastructure CityWise"],
  ],
  [2000, 800, 4200, 2360]
));
children.push(NL());

children.push(H3("4-step matching logic (CC Match Config tab)"));
children.push(P(T("When a CC transaction arrives, the system runs these 4 steps in order. First match wins.")));
children.push(NL());

children.push(simpleTable(
  ["Step", "Rule ID", "Logic", "On match", "On no match"],
  [
    ["1. Exact", "CC-MATCH-01", "LOWER(merchant) == pattern", "Auto-match. Use vendor.", "→ Step 2"],
    ["2. Contains", "CC-MATCH-02", "LOWER(merchant) CONTAINS pattern. Longest pattern wins.", "Auto-match. Use vendor.", "→ Step 3"],
    ["3. Fuzzy", "CC-MATCH-03", "Levenshtein(merchant, zoho_vendor_names) > 80%", "SUGGEST only. Top 3 to Tushar. Never auto-confirm.", "→ Step 4"],
    ["4. No match", "CC-MATCH-04", "No pattern and no fuzzy suggestion above threshold", "Route to Q3 exception. Tushar adds pattern manually.", "—"],
  ],
  [1200, 1600, 3400, 1600, 1560]
));
children.push(NL());

children.push(P(B("Pattern priority rules (resolves conflicts):")));
children.push(P(T("1. Longest pattern wins: 'amazon web services' beats 'amazon' for AWS transactions.")));
children.push(P(T("2. Exact match beats contains beats fuzzy.")));
children.push(P(T("3. On ties within contains: earlier row in the sheet wins.")));
children.push(P(T("4. Critical: 'hdfc ergo' (insurance, row 33) must match before 'hdfc bank' (row 34) — longer pattern checked first.")));
children.push(NL());

children.push(H3("Known conflict traps (documented in sheet notes)"));
children.push(simpleTable(
  ["Merchant string", "Correct match", "Trap", "Resolution"],
  [
    ["AMAZON WEB SERVICES AWS.AMAZON.COM", "VND-0015 AWS (overseas, RCM)", "Just 'amazon' matches Amazon India marketplace", "Pattern 'amazon web services' is more specific → wins. 'amazon' alone = AMBIGUOUS → Q3."],
    ["HDFC BANK FIN CHARGES", "VND-0202 HDFC Bank (is_bank=yes)", "'hdfc ergo' is different vendor (insurance)", "'hdfc ergo' pattern checked first (longer). 'hdfc bank' only matches if 'ergo' absent."],
    ["GOOGLE ADS CAMPAIGN", "VND-0087 Google India (advertising)", "'google cloud' is different vendor + GL", "'google ads' and 'google cloud' are separate patterns. Just 'google' alone = AMBIGUOUS → Q3."],
    ["ZOHO ONE ANNUAL RENEW", "VND-0041 Zoho (SaaS)", "Multiple Zoho patterns exist", "'zoho one' matches first (more specific, has gl_override). 'zoho' is fallback."],
  ],
  [3200, 2400, 2000, 1760]
));
children.push(NL());

children.push(H3("Maintenance workflow (Tushar)"));
children.push(P(B("When an unmatched CC transaction arrives:")));
children.push(P(T("1. System routes to Q3 exception queue with: raw merchant string, amount, date, top 3 fuzzy suggestions (if any).")));
children.push(P(T("2. Tushar reviews the Q3 exception. If a fuzzy suggestion is correct → confirms it. System auto-adds the merchant_pattern to the CC Merchant Map tab with status='confirmed'.")));
children.push(P(T("3. If no good suggestion → Tushar adds a new row manually in the CC Merchant Map tab: merchant_pattern, zoho_vendor_id, gst_treatment, is_bank, gl_override.")));
children.push(P(T("4. Cache refreshes within 15 minutes. Next time the same merchant string appears, it auto-matches. Same merchant never hits Q3 again.")));
children.push(P(T("5. Over 3 months, Q3 CC volume trends toward zero as patterns accumulate. Target: <5% unmatched after 90 days.")));
children.push(NL());

children.push(P(B("Fuzzy matching configuration:")));
children.push(simpleTable(
  ["Setting", "Value", "Rationale"],
  [
    ["fuzzy_enabled", "yes", "Helps Tushar identify likely matches — reduces manual lookup time"],
    ["fuzzy_threshold", "80%", "Below 80%: too many false positives. Above 90%: misses valid matches."],
    ["fuzzy_auto_confirm", "no (NEVER)", "Controls principle: human confirms every fuzzy match. System suggests, human decides."],
    ["fuzzy_algorithm", "Levenshtein (normalized)", "Character-level edit distance. Works well for merchant name typos."],
    ["fuzzy_compare_against", "All Zoho vendor display_names", "GET /contacts → display_name. Refreshed daily."],
    ["fuzzy_max_suggestions", "3", "Top 3 shown in Q3 exception report. More = decision fatigue."],
  ],
  [2400, 2400, 4560]
));
children.push(NL());

children.push(P(B("Card holder mapping (also in CC Match Config):")));
children.push(simpleTable(
  ["Card last-4", "Holder", "Zoho CC account ID", "Account name"],
  [
    ["****4521", "Tushar Mehta", "2295010000002901910", "HSBC CC - Tushar"],
    ["****7893", "Akash Jain", "2295010000002901911", "HSBC CC - Akash"],
    ["Unmapped", "— (FLAGGED)", "2295010000002901910", "HSBC CC - Default (flagged for review)"],
  ],
  [1600, 2000, 2800, 2960]
));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ═══════════════════════════════════════════════════════════════════
// PART 2: RISK REGISTER
// ═══════════════════════════════════════════════════════════════════
children.push(H1("Part 2: Risk register (14 risks)"));
children.push(PI("Every risk has a specific failure scenario, blast radius, mitigation, and fallback. Risks are prioritized: build before Phase 1 (non-negotiable), before Phase 2 (important), or process-only (no code)."));

const risks = [
  { id: "R01", sev: "CRITICAL", name: "CC 3-step partial failure", scenario: "Bill created but journal fails → orphan entry in Zoho. Vendor shows open payable that can never be settled. CC statement and books diverge.", mitigation: "Saga pattern with compensation. If step 2 fails, auto-reverse step 1. Idempotency keys on every Zoho API call (HSBC-{txn_id}-{step}).", when: "Phase 1" },
  { id: "R02", sev: "CRITICAL", name: "Duplicate posting on retry", scenario: "Bill posts, process crashes before marking 'posted'. Hourly recheck re-processes → second draft bill. Double payment risk.", mitigation: "Write-ahead log in PostgreSQL with unique constraint on (source, invoice_number, vendor_id). Pre-check Zoho before creation.", when: "Phase 1" },
  { id: "R03", sev: "HIGH", name: "Draft-to-live mode switch inconsistency", scenario: "DEPLOY_MODE flipped but bills mid-pipeline have mixed draft/live state.", mitigation: "Epoch-based transition: bills before cutoff timestamp stay draft regardless of mode. Drain queue before switch.", when: "Phase 2" },
  { id: "R04", sev: "CRITICAL", name: "Zoho OAuth token expiry", scenario: "Refresh token expires (90 days) or revoked. All Zoho API calls fail silently. Bills stack up with generic errors.", mitigation: "Health check every 5 min (GET /organization). Proactive refresh at T-10min. If refresh fails → pause pipeline + CRITICAL Slack alert.", when: "Phase 1" },
  { id: "R05", sev: "HIGH", name: "Google Sheets API quota exhaustion", scenario: "15-min cache refresh exceeds 60 reads/min quota. System runs on stale rules silently.", mitigation: "Version hash check first (1 API call). Full read only if rules changed. Staleness alert if last_refresh > 30 min.", when: "Phase 1" },
  { id: "R06", sev: "HIGH", name: "Redis cache loss", scenario: "Redis restarts → all cached rules and queue states gone. First bills process with no validation rules loaded.", mitigation: "Warm-on-start: block startup until rules loaded from Google Sheets. PostgreSQL as source of truth for state, Redis as read cache only.", when: "Phase 1" },
  { id: "R07", sev: "HIGH", name: "Zoho API rate limiting during CC batch", scenario: "247 CC transactions × 4 API calls each = 988 calls. Zoho rate-limits at 100/min. After 25 transactions, everything fails.", mitigation: "Rate-limited FIFO queue: max 40 Zoho API calls/min. Process 1 transaction at a time. Batch progress tracking in PostgreSQL.", when: "Phase 3" },
  { id: "R08", sev: "CRITICAL", name: "RCM miss on overseas vendor", scenario: "Vendor added with gst_treatment='registered' instead of 'overseas'. RCM engine trusts the field. 18% IGST liability missed. Known gap: 36/289 historical misses.", mitigation: "Multi-signal detection: cross-check GSTIN presence + currency + country + place of supply. Any overseas signal + registered treatment → flag Q1. Vendor onboarding gate.", when: "Phase 1" },
  { id: "R09", sev: "HIGH", name: "TDS Section 393 migration gap", scenario: "591 bills using old 194-series after April 2026. New section mapping incomplete. TDS returns rejected.", mitigation: "Dual-track TDS with effective_from/effective_to columns. Pre-migration dry-run against all 591 bills. Saurav validates mapping.", when: "Phase 1" },
  { id: "R10", sev: "HIGH", name: "Audit trail gap between services", scenario: "Shared services log actions but don't include bill_id. Auditor can't reconstruct decisions for a specific bill.", mitigation: "Correlation ID generated by orchestrator, passed through every service call. Every log entry, DB row, Slack message includes it.", when: "Phase 1" },
  { id: "R11", sev: "MEDIUM", name: "Hourly recheck storms", scenario: "All 8 queues recheck simultaneously → 500 API calls in burst → rate limit hit.", mitigation: "Stagger per queue: Q1 at :00, Q2 at :07, Q3 at :15, etc. Smart recheck: re-validate only the failed rule, not the full pipeline.", when: "Phase 2" },
  { id: "R12", sev: "MEDIUM", name: "No rollback for bad rule change", scenario: "Finance team edits wrong row in Google Sheet. 40 bills process with wrong TDS rate before anyone notices.", mitigation: "Rule change diff tracking on every cache refresh. Slack alert on critical field changes. 30-min cool-off period before applying.", when: "Phase 2" },
  { id: "R13", sev: "MEDIUM", name: "Mahesh single-approver bottleneck", scenario: "89% of approvals through Mahesh. A4 sends more reminders → notification fatigue. Approval cycle stays at 3.7 days.", mitigation: "Department-based routing table: Engineering → VP Eng, Marketing → Marketing Head, fallback → Mahesh. Auto-delegation after 48h.", when: "Phase 1 (process)" },
  { id: "R14", sev: "MEDIUM", name: "Finance team edits live rules without testing", scenario: "Typo in condition_value → every inter-state invoice fails → false exception storm.", mitigation: "Dual-sheet model: Draft sheet (finance edits) + Live sheet (system reads). Promotion workflow with dry-run validation. Or: test_mode column in Phase 1.", when: "Phase 2" },
];

risks.forEach(r => {
  const shade = r.sev === "CRITICAL" ? dangerShade : r.sev === "HIGH" ? warnShade : { fill: "E3F2FD", type: ShadingType.CLEAR };
  children.push(H3(`${r.id}: ${r.name} [${r.sev}]`));
  children.push(P(B("Failure scenario: "), T(r.scenario)));
  children.push(P(B("Mitigation: "), T(r.mitigation)));
  children.push(P(B("Build when: "), T(r.when)));
  children.push(NL());
});

// Priority summary
children.push(H2("Risk mitigation priority"));
children.push(simpleTable(
  ["Priority", "Risks", "Build when"],
  [
    ["Non-negotiable before Phase 1", "R01, R02, R04, R05, R06, R08, R09, R10", "Week 1-3"],
    ["Important before Phase 2", "R03, R11, R12, R14", "Week 3-4"],
    ["Build when CC batch starts", "R07", "Phase 3 (Week 4-5)"],
    ["Process change (no code)", "R13", "Immediately — configure routing table"],
  ],
  [3200, 3600, 2560]
));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ═══════════════════════════════════════════════════════════════════
// PART 3: SHARED SERVICE CONTRACTS
// ═══════════════════════════════════════════════════════════════════
children.push(H1("Part 3: Shared service contracts"));
children.push(PI("Each service defines a strict input/output interface. Orchestrators call services via this contract. Services never call orchestrators. This section is the developer reference for implementation."));

const services = [
  { name: "Vendor Service", input: "{ identifier: string, source_type: 'zoho'|'cc', gstin?: string }", output: "{ matched: boolean, vendor_id: string, vendor_name: string, gst_treatment: string, is_active: boolean, is_bank: boolean, match_method?: string, fuzzy_suggestions?: array }", notes: "Zoho sends vendor_name + GSTIN from PDF → direct Zoho Books lookup. CC sends raw merchant string → runs 4-step matching against CC Merchant Map (exact → contains → fuzzy → Q3). See section 1.9 for full matching logic. Bank vendors (HSBC, HDFC, etc.) flagged with is_bank=true. match_method returns 'exact'/'contains'/'fuzzy'/'none'. fuzzy_suggestions returns top 3 for Q3 exception report." },
  { name: "GL Classifier", input: "{ text: string, source_type: 'zoho'|'cc', hsn_sac?: string }", output: "{ gl_rule: string, gl_account: string, sac_code: string, is_manual: boolean, is_restaurant: boolean }", notes: "Zoho uses HSN/SAC code first, falls back to keyword. CC uses keywords only. Restaurant keywords (swiggy, zomato, food) override to Staff Welfare for CC. GL-015 = manual/suspense." },
  { name: "RCM Engine", input: "{ vendor_gst_treatment: string, is_overseas: boolean, vendor_gstin?: string, currency?: string, vendor_country?: string }", output: "{ rcm_required: boolean, tax_type: string, tax_id: string, tax_rate: number, confidence: string }", notes: "Multi-signal detection (R08 mitigation): don't trust gst_treatment alone. Cross-check GSTIN presence, currency, country. If any signal says overseas but treatment says registered → confidence='low', flag Q1." },
  { name: "Duplicate Checker", input: "{ invoice_number?: string, vendor_id: string, amount: number, date: string, source_type: 'zoho'|'cc', merchant?: string }", output: "{ has_duplicate: boolean, match_type: 'exact'|'fuzzy'|'cross_vendor'|'cc_duplicate', duplicate_ref?: string }", notes: "Zoho: exact invoice# + vendor, fuzzy Levenshtein < 2, cross-vendor same amount+date. CC: merchant + amount + date." },
  { name: "Score Calculator", input: "{ rule_results: Array<{ rule_id, passed, severity, penalty }> }", output: "{ score: number, route: 'auto'|'approval'|'exception', failed_rules: string[], failed_queues: string[] }", notes: "Only called by Zoho orchestrator. CC skips scoring. Score = 100 + sum(penalties of failed rules). Critical = -30, Warning = -10, Info = 0." },
  { name: "Exception Router", input: "{ failures: Array<{ rule_id, queue_bucket, severity, detail }>, source_type: string, correlation_id: string }", output: "{ queue_assignments: Array<{ queue, owner, sla, slack_sent }> }", notes: "Uniform report format regardless of source. Includes correlation_id for audit trail. Sends Slack DM to queue owner + posts to #ap-exceptions." },
  { name: "Zoho Poster", input: "{ entry_type: 'bill'|'journal'|'payment', payload: object, draft_mode: boolean, idempotency_key: string, correlation_id: string }", output: "{ zoho_id: string, status: string, posted_fields: object }", notes: "SINGLE write gate for ALL Zoho mutations. draft_mode from DEPLOY_MODE env var (R03 epoch-based transition). Idempotency key prevents duplicate posting (R02). Rate limiter built in (R07)." },
  { name: "Proof Checker", input: "{ zoho_bill_id: string, original_input: object, correlation_id: string }", output: "{ all_match: boolean, mismatches: Array<{ field, expected, actual }> }", notes: "Re-reads from Zoho API: vendor_name, total, GST amount, TDS section, RCM flag, GL account, invoice number. Any mismatch → Q8 + immediate Slack to Tushar." },
  { name: "Notification Engine", input: "{ type: 'approval_request'|'exception'|'reminder'|'escalation'|'digest', recipient: string, bill_summary: object }", output: "{ sent: boolean, channel: 'slack'|'email', timestamp: string }", notes: "Internal Slack = Hindi/English casual mix. Vendor email = English formal. Every message includes Zoho Books approval link + correlation_id. Approval reminder format: emoji header, Hindi greeting, bill count + total value, monospace table (Vendor | Bill No. | Amount | TOTAL), Tushar contact note, 'Approve on Zoho Books' deep link button." },
  { name: "Audit Logger", input: "{ correlation_id: string, event_type: string, agent: string, rule_id?: string, input_snapshot: object, output_snapshot: object }", output: "{ logged: boolean, event_id: string }", notes: "PostgreSQL table. Correlation ID links all events for one bill. Includes input/output snapshots for every decision. Retention: indefinite (compliance requirement)." },
];

services.forEach(s => {
  children.push(H3(s.name));
  children.push(P(B("Input: "), M(s.input)));
  children.push(P(B("Output: "), M(s.output)));
  children.push(P(B("Notes: "), T(s.notes)));
  children.push(NL());
});

children.push(new Paragraph({ children: [new PageBreak()] }));

// ═══════════════════════════════════════════════════════════════════
// PART 4: IMPLEMENTATION PLAN
// ═══════════════════════════════════════════════════════════════════
children.push(H1("Part 4: Implementation plan"));
children.push(PI("Updated from V8. Risk mitigations integrated into each phase. Codebase structure reflects orchestrator + services model."));

children.push(H2("Codebase structure (Phase 1: monorepo)"));
children.push(P(T("One repository. One Railway deployment. Clean module boundaries ready for future splitting.")));
children.push(NL());
children.push(simpleTable(
  ["Folder", "Type", "Contents"],
  [
    ["/src/orchestrators/zoho-invoice", "Source-specific", "12-step Zoho flow. Document classifier, PDF extractor, TDS validator."],
    ["/src/orchestrators/cc-transaction", "Source-specific", "13-step CC flow. Skip rules, merchant matcher, card mapper, saga coordinator."],
    ["/src/services/vendor", "Shared", "Vendor lookup, GSTIN match, bank detect. Single source of truth."],
    ["/src/services/gl-classifier", "Shared", "Keyword → GL. HSN lookup. Restaurant override."],
    ["/src/services/rcm-engine", "Shared", "Multi-signal overseas detection. IGST RCM application."],
    ["/src/services/duplicate-checker", "Shared", "Exact, fuzzy (Levenshtein), cross-vendor, CC duplicate."],
    ["/src/services/score-calculator", "Shared", "Sum penalties → 0-100. Route decision."],
    ["/src/services/exception-router", "Shared", "Q1-Q8 assignment. Slack alerts. SLA tracking."],
    ["/src/services/zoho-poster", "Shared", "Bill/journal/payment API. Rate limiter. Idempotency. Draft mode."],
    ["/src/services/proof-checker", "Shared", "7-field post-posting verification."],
    ["/src/services/notification", "Shared", "Slack DM, email, escalation, digest."],
    ["/src/services/audit-logger", "Shared", "PostgreSQL event log. Correlation ID threading."],
    ["/src/rules/sheet-reader", "Config", "Google Sheets API → Redis cache. Version hash optimization."],
    ["/src/rules/rule-executor", "Config", "Run rules by tab + source_filter + execution_order."],
    ["/src/infra/db", "Infrastructure", "PostgreSQL schemas, migrations, bill_lifecycle table."],
    ["/src/infra/cache", "Infrastructure", "Redis setup, warm-on-start, 15-min refresh."],
    ["/src/infra/cron", "Infrastructure", "Staggered queue recheck, 12-hr follow-up, cache refresh."],
  ],
  [3200, 1400, 4760]
));

children.push(H2("Phase 1: Architecture build + QA (Week 1-3)"));
children.push(simpleTable(
  ["Task", "Includes", "Risk mitigations built"],
  [
    ["Build orchestrators", "Zoho 12-step + CC 13-step flows. Saga for CC 3-step.", "R01 (saga), R02 (dedup), R10 (correlation ID)"],
    ["Build shared services", "All 10 services with strict contracts. Unit tests per service.", "R08 (multi-signal RCM), R04 (Zoho health check)"],
    ["Set up rules engine V2", "15-tab Google Sheet. Cache with version hash. Warm-on-start.", "R05 (quota), R06 (cache loss), R09 (Section 393)"],
    ["Set up CC Merchant Map", "45 pre-populated patterns. 4-step matching logic. Fuzzy config. Tushar trained on maintenance workflow.", "CC-MATCH-01 to 04 rules. Q3 exception flow for unmatched."],
    ["QA testing (3-4 hours)", "Run against 3 months historical. Compare vs Zoho posted entries.", "All rules validated against real data"],
    ["Configure approval routing", "Department → approver mapping table. Backup approvers.", "R13 (Mahesh bottleneck — process change)"],
  ],
  [2200, 3800, 3360]
));

children.push(H2("Phase 2: Live posting (after FC sign-off)"));
children.push(simpleTable(
  ["Task", "Includes", "Risk mitigations built"],
  [
    ["FC sign-off", "Akash reviews QA report, confirms accuracy.", "—"],
    ["Epoch-based go-live", "Drain queue. Flip mode. Clean cutoff timestamp.", "R03 (draft-to-live transition)"],
    ["Score gate activation", "90+/70-89/<70 routing. CC bypass confirmed.", "—"],
    ["Exception queue go-live", "Staggered rechecks. SLA tracking. Smart recheck.", "R11 (recheck storms)"],
    ["Rule change controls", "Diff tracking. Cool-off period. Dual-sheet or test_mode.", "R12 (bad rule change), R14 (untested rules)"],
  ],
  [2200, 3800, 3360]
));

children.push(H2("Phase 3: CC pipeline + prepaid (Week 4-5)"));
children.push(simpleTable(
  ["Task", "Includes", "Risk mitigations built"],
  [
    ["CC batch processing", "FIFO queue with 40 calls/min rate limit. Batch progress tracking.", "R07 (rate limiting)"],
    ["CC 3-step pipeline live", "Vendor bill + journal + settlement. Saga compensation tested.", "R01 (verified in production)"],
    ["Prepaid detection", "Agent checks service dates. Flag in prepaid sheet. No GL routing Phase 1.", "—"],
  ],
  [2600, 3800, 2960]
));

children.push(H2("Phase 4: Reconciliation + advanced (Week 6-8)"));
children.push(P(T("GST 2B reconciliation (16th of month batch). Vendor balance reconciliation (quarterly). Provision sync (Google Sheet vs Zoho actuals).")));

// ═══════════════════════════════════════════════════════════════════
// WORKFLOW PORTAL (NEW)
// ═══════════════════════════════════════════════════════════════════
children.push(H2("4.5  Workflow portal (dashboard)"));
children.push(PI("Web-based dashboard providing role-based views of the entire AP pipeline. Each role sees only what they need. Business users never see compliance details or scores."));
children.push(NL());

children.push(P(B("5 tabs in the portal:")));
children.push(simpleTable(
  ["Tab", "What it shows", "Who sees it"],
  [
    ["Overview", "5 metric cards (total, posted, exceptions, pending approval, overrides). 8 exception queue grid with live counts. Click any queue to drill into exceptions.", "Admin, Accounts"],
    ["Period analytics", "Monthly / Weekly / Custom period views. Document intake counts, action breakdown (posted/exception/parked), volume in rupees, success rate %, GL spend breakdown, trend charts. Note: no 'skipped' status — all transactions visible.", "Admin, Accounts"],
    ["Exception queues", "Bills held in Q1-Q8 with reason, failed rules, vendor, amount. Take Action panel: resolve + re-validate, force post (override with mandatory notes + FC notification), reassign queue, reject permanently. Includes former 'skipped' cases (IGST Assessment, reversals) now visible in Q5.", "Admin, Accounts (own queues only)"],
    ["All bills", "Full bill table with filters: source (Zoho/CC), status (posted/exception/pending/parked). Click any exception to take action.", "Admin, Accounts"],
    ["Pending in Zoho (monitoring)", "Bills currently pending business approval in Zoho Books. Status shown as 'In Zoho (monitoring)' — NOT 'approval_pending'. Design principle: approval is a Zoho Books workflow, our portal only monitors and reminds. Akash/admin triggers Slack reminder via 'Send reminder on Slack' button. Approval action happens IN ZOHO BOOKS only — deep link in Slack message takes approver directly there.", "Admin (send reminder button). Approver (monitoring only — acts in Zoho)."],
    ["Transaction detail modal", "Click any bill (posted, exception, parked, or in_zoho) to open the detail panel. 3 tabs: (1) Invoice Document — for Zoho bills: shows PDF viewer with tax invoice, GSTIN, HSN/SAC, GST breakdown. For parked: shows why parked. (2) CC Statement — for CC transactions: shows raw HSBC statement row (txn date, post date, merchant, card holder, ref no, amount). No invoice document exists for CC. (3) Edit Zoho Entry — EDITABLE for draft/exception bills: dropdowns for GL Account (14 options), GST Type (CGST+SGST / IGST / IGST RCM), TDS Section (194J/194C/194I/194D/Section 393/Not applicable). Live recalculates base, GST, TDS deduction, net payable. 'Save changes to Zoho' button calls Zoho Books API to update the draft bill. READ-ONLY for posted bills — controls rule: posted accounting entries are immutable. To correct a posted bill, void and re-enter in Zoho.", "Admin, Accounts"],
    ["Audit log", "Every override action logged: who, when, which bill, action taken, reason notes. Reconstructable in 5 minutes.", "Admin"],
  ],
  [1800, 4200, 3360]
));
children.push(NL());

children.push(P(B("Period analytics — 3 viewing modes:")));
children.push(simpleTable(
  ["Mode", "What it shows", "Controls"],
  [
    ["Monthly", "4 month cards (Jan-Apr). Each card: received, posted, exception, parked, volume, success rate bar, %. Trend chart (area) + action breakdown chart (stacked bar).", "Click any month to drill down"],
    ["Weekly", "Current month split by week (W1-W4). Weekly volume bar chart + weekly action stacked bar.", "Automatic for current month"],
    ["Custom period", "Date range picker (From/To). Metrics: received, posted, exception, parked, pending, volume. Progress bar. Source split (Zoho/CC). GL spend breakdown (horizontal bar). Full bill list for period. No 'skipped' status — all transactions route to exception queues.", "From date + To date pickers"],
  ],
  [1600, 4800, 2960]
));
children.push(NL());

children.push(P(B("Exception action workflow (4 options):")));
children.push(simpleTable(
  ["Action", "What happens", "Controls (audit-ready)"],
  [
    ["Resolve + re-validate", "Issue fixed (vendor created, GSTIN corrected). Bill re-enters pipeline. ALL 93 rules re-run from scratch. If passes → routes normally. If fails again → new exception.", "Optional notes. No override — system decides again."],
    ["Force post (override)", "Human confirmed bill valid despite system flag. Bill skips remaining validation, posts to Zoho. Proof-check STILL runs after posting.", "MANDATORY reason text. Checkbox confirmation. FC notified via Slack DM. Full audit trail: who, when, why, which rules overridden."],
    ["Reassign queue", "Bill moved to different exception queue. Wrong team got it. SLA timer resets.", "New queue selection. Old exception marked 'reassigned'. New owner notified."],
    ["Reject permanently", "Bill should not be processed. Cannot be undone. Submitter notified (SUB-002).", "MANDATORY rejection reason. Logged in audit trail for compliance."],
  ],
  [2000, 3600, 3760]
));
children.push(NL());

children.push(P(B("Role-based access:")));
children.push(simpleTable(
  ["Role", "Who", "Tabs visible", "What they can do"],
  [
    ["Admin", "Akash (FC)", "All 5 tabs", "View everything. Take action on any exception. View audit log. See all period analytics."],
    ["Accounts", "Tushar, Saurav, Mahesh", "Overview, Period, Queues, Bills", "See assigned queues only. Take action on own exceptions. View period analytics."],
    ["Approver", "Dept heads", "Pending approvals (monitoring only)", "Sees bills awaiting approval in Zoho Books with vendor name, amount, GL, days pending. Direct link to open each bill in Zoho Books to approve or reject. NO approve/reject buttons in portal — action happens in Zoho. Portal only monitors Zoho pendency and shows status."],
  ],
  [1200, 2200, 2400, 3560]
));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ═══════════════════════════════════════════════════════════════════
// PART 5: REFERENCE DATA (carried from V8)
// ═══════════════════════════════════════════════════════════════════
children.push(H1("Part 5: Reference data"));

children.push(H2("5.1  Key Zoho IDs"));
children.push(simpleTable(
  ["Constant", "Zoho ID", "Purpose"],
  [
    ["ORG_ID", "60036724867", "Organization (every API call)"],
    ["MAHESH_USER_ID", "2295010000000931179", "Approver user ID"],
    ["IGST18_TAX_ID", "2295010000001409879", "IGST 18% — overseas RCM"],
    ["GST18_TAX_ID", "2295010000001409981", "GST 18% (CGST9+SGST9)"],
    ["Accounts Payable", "2295010000000000471", "AP account for journals"],
    ["Suspense", "2295010000001621645", "Unmatched merchant fallback (GL-015)"],
    ["Staff Welfare", "2295010000000044787", "Restaurant CC spends"],
    ["Default HSBC CC", "2295010000002901910", "Card holder fallback"],
  ],
  [2600, 3200, 3560]
));

children.push(H2("5.2  Key links"));
children.push(simpleTable(
  ["Resource", "Link / ID", "Purpose"],
  [
    ["Rules Engine V2 Sheet", "(to be uploaded)", "89 rules across 13 tabs — system reads via API"],
    ["Architecture Doc (this)", "V9 — this document", "Updated from V8 with orchestrator model"],
    ["HSBC CC Google Sheet", "Existing — auto-updated via Postman", "CC transaction input source"],
    ["Prepaid Sheet", "PENDING — Akash to provide", "Prepaid flagging output"],
  ],
  [2600, 3200, 3560]
));

children.push(H2("5.3  Historical analysis (883 bills, Jan-Apr 2026)"));
children.push(simpleTable(
  ["Finding", "Value", "V9 mitigation"],
  [
    ["Overseas bills WITHOUT RCM", "36/289 (12.5% miss)", "R08: Multi-signal overseas detection in RCM Engine"],
    ["Unregistered WITHOUT TDS", "31 bills", "TDS-007 rule + R09: Section 393 migration"],
    ["Single approver (Mahesh)", "89% of all approvals", "R13: Department-based routing table"],
    ["Avg approval cycle", "3.7 days (176 > 7 days)", "A4 follow-up every 12h + auto-delegation at 48h"],
    ["Outstanding payables", "₹1.92 Cr (₹84.9L overdue)", "Faster approval cycle + CC auto-posting"],
    ["Old 194-series post Apr 2026", "591 bills to migrate", "R09: Dual-track TDS with effective dates"],
  ],
  [2800, 2400, 4160]
));

children.push(H2("5.4  Decision items"));
children.push(simpleTable(
  ["#", "Decision", "Recommended", "Status"],
  [
    ["1", "Auto-approve threshold score", "90 (conservative)", "V8 — confirm"],
    ["2", "Exception-route threshold", "< 70", "V8 — confirm"],
    ["3", "Approval SLA before L2 escalation", "48 hours", "V8 — confirm"],
    ["4", "Bank charges treatment", "Full 3-step pipeline (not skip)", "V9 — CHANGED from V8"],
    ["5", "CC skip rules REMOVED", "Controls decision 2026-04-22: No silent skipping. IGST Assessment → Q5 (Saurav confirms). Amount ≤ 0 (reversal) → Q5 (Tushar matches original). Every transaction visible to at least one human.", "DECIDED — no silent skipping"],
    ["6", "Architecture model", "Orchestrators + shared services (not single pipeline)", "V9 — NEW"],
    ["7", "Rules sheet structure", "V2: 89 rules, 13 tabs, 6 new columns", "V9 — NEW"],
    ["8", "Approval routing table", "Department-based, not single approver", "V9 — NEW"],
    ["9", "Draft-to-live transition", "Epoch-based with queue drain", "V9 — NEW"],
    ["10", "Rule change process", "Dual-sheet (draft → live) or test_mode column", "V9 — NEW"],
  ],
  [400, 3400, 2800, 2760]
));

children.push(NL());
children.push(P(B("Next step: "), T("Team reviews V9 document + V2 rules sheet. Resolve decision items 1-3 (carried from V8) and 4-10 (new in V9). Confirm Phase 1 kickoff. Begin building orchestrators and shared services.")));
children.push(NL());
children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [T("Confidential  |  Wiom Finance Autopilot V9  |  Page ", { size: 18, color: "999999" })] }));

// ═══════════════════════════════════════════════════════════════════
// CREATE DOCUMENT
// ═══════════════════════════════════════════════════════════════════
const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 400, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 300, after: 150 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1200, right: 1200, bottom: 1200, left: 1200 }
      }
    },
    children
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("/mnt/user-data/outputs/Wiom_Finance_Autopilot_V9.docx", buffer);
  console.log("V9 document created successfully");
});
