// src/services/contracts.js — Service contract definitions
// Every shared service MUST conform to these input/output shapes.
// Agents 2-4 build against these contracts. Mocks use them for testing.
// If you change a contract, ALL agents must be notified.

/**
 * @typedef {Object} VendorInput
 * @property {string} identifier - vendor name (zoho) or merchant string (cc)
 * @property {'zoho'|'cc'} sourceType
 * @property {string} [gstin] - from invoice (zoho only)
 */

/**
 * @typedef {Object} VendorOutput
 * @property {boolean} matched
 * @property {string|null} vendorId - Zoho vendor ID
 * @property {string} vendorName
 * @property {string} gstTreatment - registered/overseas/unregistered/unknown
 * @property {boolean} isActive
 * @property {boolean} isBank
 * @property {string} [matchMethod] - exact/contains/fuzzy/none (CC only)
 * @property {Array<{name:string,score:number}>} [fuzzySuggestions] - top 3 (CC only)
 */

/**
 * @typedef {Object} GLInput
 * @property {string} text - description text to classify
 * @property {'zoho'|'cc'} sourceType
 * @property {string} [hsnSac] - HSN/SAC code (zoho invoices)
 */

/**
 * @typedef {Object} GLOutput
 * @property {string} glRule - GL-001 to GL-016
 * @property {string} glAccount - account name
 * @property {string} sacCode - SAC/HSN code
 * @property {boolean} isManual - true if GL-015 fired
 * @property {boolean} isRestaurant - true if restaurant override
 * @property {string} [glOverride] - forced GL from merchant map
 */

/**
 * @typedef {Object} RCMInput
 * @property {string} vendorGstTreatment
 * @property {boolean} isOverseas
 * @property {string} [vendorGstin]
 * @property {string} [currency]
 * @property {string} [vendorCountry]
 */

/**
 * @typedef {Object} RCMOutput
 * @property {boolean} rcmRequired
 * @property {string} taxType - 'IGST' or 'none'
 * @property {string} taxId - Zoho tax ID
 * @property {number} taxRate - 18 or 0
 * @property {'high'|'low'} confidence - low if signals conflict
 * @property {string[]} signals - which signals fired
 */

/**
 * @typedef {Object} DuplicateInput
 * @property {string} [invoiceNumber] - zoho only
 * @property {string} vendorId
 * @property {number} amount
 * @property {string} date - ISO date
 * @property {'zoho'|'cc'} sourceType
 * @property {string} [merchantString] - CC only
 */

/**
 * @typedef {Object} DuplicateOutput
 * @property {boolean} hasDuplicate
 * @property {'exact'|'fuzzy'|'cross_vendor'|'cc_duplicate'|null} matchType
 * @property {string|null} duplicateRef - correlation_id of the duplicate
 */

/**
 * @typedef {Object} ScoreInput
 * @property {Array<{rule_id:string, passed:boolean, severity:string, penalty:number}>} ruleResults
 */

/**
 * @typedef {Object} ScoreOutput
 * @property {number} score - 0-100
 * @property {'auto'|'approval'|'exception'|'cc_pipeline'} route
 * @property {string[]} failedRules
 * @property {string[]} failedQueues
 */

/**
 * @typedef {Object} ExceptionInput
 * @property {Array<{rule_id:string, queue_bucket:string, severity:string, detail:string}>} failures
 * @property {string} sourceType
 * @property {string} correlationId
 * @property {Object} billContext - vendor, amount, etc. for the report
 */

/**
 * @typedef {Object} ExceptionOutput
 * @property {Array<{queue:string, owner:string, sla:string, slackSent:boolean}>} queueAssignments
 */

/**
 * @typedef {Object} ZohoPostInput
 * @property {'bill'|'journal'|'payment'} entryType
 * @property {Object} payload - Zoho API body
 * @property {boolean} draftMode
 * @property {string} idempotencyKey
 * @property {string} correlationId
 */

/**
 * @typedef {Object} ZohoPostOutput
 * @property {string|null} zohoId
 * @property {string} status - 'draft'|'open'|'failed'
 * @property {Object} postedFields - what was actually written
 */

/**
 * @typedef {Object} ProofCheckInput
 * @property {string} zohoBillId
 * @property {Object} originalInput - the input data we sent
 * @property {string} correlationId
 */

/**
 * @typedef {Object} ProofCheckOutput
 * @property {boolean} allMatch
 * @property {Array<{field:string, expected:any, actual:any}>} mismatches
 */

/**
 * @typedef {Object} NotificationInput
 * @property {'approval_request'|'exception'|'reminder'|'escalation'|'digest'} type
 * @property {string} recipient - Slack user ID or email
 * @property {Object} billSummary
 * @property {string} correlationId
 */

/**
 * @typedef {Object} NotificationOutput
 * @property {boolean} sent
 * @property {'slack'|'email'} channel
 * @property {string} timestamp
 */

// Export contract names for reference
module.exports = {
  SERVICE_NAMES: [
    'vendor', 'gl-classifier', 'rcm-engine', 'duplicate-checker',
    'score-calculator', 'exception-router', 'zoho-poster',
    'proof-checker', 'notification', 'audit-logger',
  ],
};
