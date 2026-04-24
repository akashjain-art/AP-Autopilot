// test/fixtures/index.js — Test data matching real Wiom scenarios

// ── Zoho invoices (from prototype + architecture doc) ──
const INVOICES = [
  { id: 'ZP-001', vendor: 'CloudTech Solutions Pvt Ltd', gstin: '27AABCC1234D1ZA', amount: 42500, type: 'Tax Invoice', date: '2026-03-15', invoiceNumber: 'CT/2026/1847', hsn: '998314', state: 'Maharashtra', gstTreatment: 'registered', currency: 'INR', description: 'SaaS subscription annual' },
  { id: 'ZP-002', vendor: 'Kapoor & Associates', gstin: '07AAFCK5678E1ZB', amount: 150000, type: 'Proforma Invoice', date: '2026-04-01', invoiceNumber: 'KA/PRO/441', hsn: '998221', state: 'Delhi', gstTreatment: 'registered', currency: 'INR', description: 'Legal consulting' },
  { id: 'ZP-003', vendor: 'Skyline Realty LLP', gstin: '06AACS9012F1ZC', amount: 287000, type: 'Tax Invoice', date: '2026-04-05', invoiceNumber: 'SR/HR/2026-04', hsn: '997212', state: 'Haryana', gstTreatment: 'registered', currency: 'INR', description: 'Office rent Gurgaon' },
  { id: 'ZP-004', vendor: 'SpeedFreight Logistics', gstin: '09AABCS3456G1ZD', amount: 0, type: 'Delivery Note', date: '2026-04-10', invoiceNumber: '', hsn: '', state: 'UP', gstTreatment: 'registered', currency: 'INR', description: 'Delivery note' },
  { id: 'ZP-005', vendor: 'Amazon Web Services', gstin: '', amount: 189340, type: 'Tax Invoice', date: '2026-03-31', invoiceNumber: 'AWS-IN-2026-Q1-7721', hsn: '998315', state: 'Overseas', gstTreatment: 'overseas', currency: 'USD', vendorCountry: 'USA', description: 'Cloud hosting Q1' },
  { id: 'ZP-006', vendor: 'Unregistered Consultant', gstin: '', amount: 75000, type: 'Tax Invoice', date: '2026-04-08', invoiceNumber: 'UC/2026/12', hsn: '998221', state: 'Delhi', gstTreatment: 'business_none', currency: 'INR', description: 'Consulting services' },
  { id: 'ZP-007', vendor: 'Amazon Web Services', gstin: '', amount: 189340, type: 'Tax Invoice', date: '2026-03-31', invoiceNumber: 'AWS-IN-2026-Q1-7721', hsn: '998315', state: 'Overseas', gstTreatment: 'overseas', currency: 'USD', vendorCountry: 'USA', description: 'DUPLICATE of ZP-005' },
];

// ── CC transactions (from prototype) ──
const CC_TRANSACTIONS = [
  { id: 'CC-001', merchant: 'ZOHO CORPORATION CHENNAI', amount: 12980, date: '2026-04-02', card: '4521', description: 'ZOHO ONE SUBSCRIPTION RENEWAL', isOverseas: false, currency: 'INR' },
  { id: 'CC-002', merchant: 'GOOGLE ADS GOOGLE.COM', amount: 45000, date: '2026-04-05', card: '4521', description: 'GOOGLE ADS CAMPAIGN CHARGE', isOverseas: true, currency: 'USD' },
  { id: 'CC-003', merchant: 'UBER INDIA TECHNOLOGY', amount: 1240, date: '2026-04-08', card: '7893', description: 'UBER TRIP BLR-WHITEFIELD', isOverseas: false, currency: 'INR' },
  { id: 'CC-004', merchant: 'AMAZON WEB SERVICES AWS.AMAZON.COM', amount: 67200, date: '2026-04-10', card: '4521', description: 'AWS MONTHLY COMPUTE + STORAGE', isOverseas: true, currency: 'USD' },
  { id: 'CC-005', merchant: 'SWIGGY BUNDL TECHNOLOGIES', amount: 2850, date: '2026-04-11', card: '7893', description: 'SWIGGY TEAM LUNCH ORDER', isOverseas: false, currency: 'INR' },
  { id: 'CC-006', merchant: 'HDFC BANK FINANCE CHARGES', amount: 590, date: '2026-04-12', card: '4521', description: 'CC FINANCE CHARGE / INTEREST', isOverseas: false, currency: 'INR' },
  { id: 'CC-007', merchant: 'IGST ASSESSMENT GOVT', amount: 8400, date: '2026-04-13', card: '4521', description: 'IGST SELF ASSESSMENT PAYMENT', isOverseas: false, currency: 'INR' },
  { id: 'CC-008', merchant: 'MAKEMYTRIP FLIGHT', amount: 18750, date: '2026-04-14', card: '7893', description: 'BLR-DEL INDIGO 6E-2241 APR19', isOverseas: false, currency: 'INR' },
  { id: 'CC-009', merchant: 'UNKNOWN MERCHANT XYZ', amount: 3500, date: '2026-04-15', card: '4521', description: 'SOME RANDOM PURCHASE', isOverseas: false, currency: 'INR' },
  { id: 'CC-010', merchant: 'HDFC ERGO INSURANCE PREMIUM', amount: 24000, date: '2026-04-16', card: '7893', description: 'ANNUAL HEALTH INSURANCE', isOverseas: false, currency: 'INR' },
  { id: 'CC-011', merchant: 'STARBUCKS INDIA MUMBAI', amount: 850, date: '2026-04-17', card: '7893', description: 'COFFEE MEETING', isOverseas: false, currency: 'INR' },
  { id: 'CC-012', merchant: 'REFUND AMAZON', amount: -1500, date: '2026-04-18', card: '4521', description: 'REFUND FOR ORDER', isOverseas: false, currency: 'INR' },
];

// ── Merchant patterns (from CC Merchant Map sheet) ──
const MERCHANT_PATTERNS = [
  { merchant_pattern: 'zoho', match_type: 'contains', zoho_vendor_id: 'VND-0041', zoho_vendor_name: 'Zoho Corporation Pvt Ltd', gst_treatment: 'registered', is_bank: false, gl_override: '', gl_rule: 'GL-001', category: 'Software/SaaS', status: 'confirmed' },
  { merchant_pattern: 'google ads', match_type: 'contains', zoho_vendor_id: 'VND-0087', zoho_vendor_name: 'Google India Pvt Ltd', gst_treatment: 'overseas', is_bank: false, gl_override: '', gl_rule: 'GL-006', category: 'Advertising', status: 'confirmed' },
  { merchant_pattern: 'uber', match_type: 'contains', zoho_vendor_id: 'VND-0122', zoho_vendor_name: 'Uber India Technology Pvt Ltd', gst_treatment: 'registered', is_bank: false, gl_override: '', gl_rule: 'GL-013', category: 'Travel', status: 'confirmed' },
  { merchant_pattern: 'amazon web services', match_type: 'contains', zoho_vendor_id: 'VND-0015', zoho_vendor_name: 'Amazon Web Services Inc', gst_treatment: 'overseas', is_bank: false, gl_override: '', gl_rule: 'GL-002', category: 'Cloud/Hosting', status: 'confirmed' },
  { merchant_pattern: 'swiggy', match_type: 'contains', zoho_vendor_id: 'VND-0156', zoho_vendor_name: 'Bundl Technologies Pvt Ltd (Swiggy)', gst_treatment: 'registered', is_bank: false, gl_override: 'Staff Welfare', gl_rule: 'GL-016', category: 'Restaurant', status: 'confirmed' },
  { merchant_pattern: 'hdfc bank', match_type: 'contains', zoho_vendor_id: 'VND-0202', zoho_vendor_name: 'HDFC Bank Ltd', gst_treatment: 'registered', is_bank: true, gl_override: 'Finance Cost', gl_rule: 'GL-012', category: 'Banking', status: 'confirmed' },
  { merchant_pattern: 'hdfc ergo', match_type: 'contains', zoho_vendor_id: 'VND-0210', zoho_vendor_name: 'HDFC Ergo GIC Ltd', gst_treatment: 'registered', is_bank: false, gl_override: 'Employee Welfare', gl_rule: 'GL-011', category: 'Insurance', status: 'confirmed' },
  { merchant_pattern: 'makemytrip', match_type: 'contains', zoho_vendor_id: 'VND-0098', zoho_vendor_name: 'MakeMyTrip India Pvt Ltd', gst_treatment: 'registered', is_bank: false, gl_override: '', gl_rule: 'GL-013', category: 'Travel', status: 'confirmed' },
  { merchant_pattern: 'starbucks', match_type: 'contains', zoho_vendor_id: 'VND-0160', zoho_vendor_name: 'Tata Starbucks Pvt Ltd', gst_treatment: 'registered', is_bank: false, gl_override: 'Staff Welfare', gl_rule: 'GL-016', category: 'Restaurant', status: 'confirmed' },
];

// ── Expected results for each test scenario ──
const EXPECTED = {
  // CC matching
  'CC-001': { matched: true, vendor: 'Zoho Corporation Pvt Ltd', method: 'contains', isBank: false, gl: 'Subscription Charges' },
  'CC-002': { matched: true, vendor: 'Google India Pvt Ltd', method: 'contains', isBank: false, rcm: true },
  'CC-003': { matched: true, vendor: 'Uber India Technology Pvt Ltd', method: 'contains', isBank: false },
  'CC-004': { matched: true, vendor: 'Amazon Web Services Inc', method: 'contains', isBank: false, rcm: true },
  'CC-005': { matched: true, vendor: 'Bundl Technologies Pvt Ltd (Swiggy)', method: 'contains', isRestaurant: true, gl: 'Staff Welfare' },
  'CC-006': { matched: true, vendor: 'HDFC Bank Ltd', method: 'contains', isBank: true, gl: 'Finance Cost' },
  'CC-007': { skip: true, reason: 'IGST assessment' },
  'CC-008': { matched: true, vendor: 'MakeMyTrip India Pvt Ltd', method: 'contains', isBank: false },
  'CC-009': { matched: false, method: 'none', queue: 'Q3' },
  'CC-010': { matched: true, vendor: 'HDFC Ergo GIC Ltd', method: 'contains', isBank: false },
  'CC-011': { matched: true, vendor: 'Tata Starbucks Pvt Ltd', method: 'contains', isRestaurant: true },
  'CC-012': { skip: true, reason: 'amount <= 0' },
  // Zoho invoices
  'ZP-001': { classified: true, score: '90+', gl: 'Subscription Charges' },
  'ZP-002': { classified: false, reason: 'Proforma Invoice — parked' },
  'ZP-003': { classified: true, score: '90+', gl: 'Infrastructure CityWise' },
  'ZP-004': { classified: false, reason: 'Delivery Note — parked' },
  'ZP-005': { classified: true, rcm: true, gl: 'Cloud Charges' },
  'ZP-006': { classified: true, tdsRequired: true },
  'ZP-007': { duplicate: true, of: 'ZP-005' },
};

module.exports = { INVOICES, CC_TRANSACTIONS, MERCHANT_PATTERNS, EXPECTED };
