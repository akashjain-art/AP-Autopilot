// src/orchestrators/zoho-invoice/pdf-extractor.js — Extract invoice fields from PDF
// Uses pdf-parse for text extraction. Regex patterns for structured Indian tax invoices.
// Returns extracted fields + OCR confidence score.

const pdfParse = require('pdf-parse');
const fs = require('fs');
const audit = require('../../services/audit-logger');

// ── Regex patterns for Indian tax invoice fields ──
const PATTERNS = {
  gstin: /\b(\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1})\b/g,
  invoiceNumber: /(?:invoice\s*(?:no|number|#|num)[\s.:]*)\s*([A-Z0-9\-\/]+)/i,
  invoiceNumberAlt: /(?:bill\s*(?:no|number|#)[\s.:]*)\s*([A-Z0-9\-\/]+)/i,
  date: /(?:(?:invoice|bill|dated?)\s*(?:date)?[\s.:]*)\s*(\d{1,2}[\-\/\.]\d{1,2}[\-\/\.]\d{2,4})/i,
  dateStandalone: /\b(\d{1,2}[\-\/\.]\d{1,2}[\-\/\.]\d{4})\b/,
  totalAmount: /(?:total|grand\s*total|net\s*amount|amount\s*payable)[\s.:]*[₹Rs.\s]*([0-9,]+\.?\d{0,2})/i,
  taxAmount: /(?:(?:igst|cgst|sgst|gst)\s*(?:amount)?[\s.:@]*\d*%?\s*[₹Rs.\s]*)([0-9,]+\.?\d{0,2})/gi,
  hsnSac: /(?:hsn|sac)[\s\/.:]*(\d{4,8})/i,
  hsnSacInTable: /\b(99\d{4})\b|\b(85\d{2})\b|\b(84\d{2})\b/,
  placeOfSupply: /(?:place\s*of\s*supply)[\s.:]*([A-Za-z\s]+?)(?:\(|\d|$)/i,
  panNumber: /\b([A-Z]{5}\d{4}[A-Z])\b/,
  invoiceType: /\b(tax\s*invoice|proforma|estimate|quotation|delivery\s*note|purchase\s*order|credit\s*note|debit\s*note)\b/i,
  buyerName: /(?:(?:bill|sold|ship)\s*to|buyer|customer)[\s.:]*\n?\s*([^\n]{5,60})/i,
  vendorName: /^([^\n]{5,80})/m, // First substantial line is often vendor name
};

async function extract(filePathOrBuffer, correlationId) {
  const start = Date.now();
  let text = '';
  let pageCount = 0;
  let confidence = 0;

  try {
    const input = Buffer.isBuffer(filePathOrBuffer)
      ? filePathOrBuffer
      : fs.readFileSync(filePathOrBuffer);

    const pdf = await pdfParse(input);
    text = pdf.text || '';
    pageCount = pdf.numpages || 1;

    // Confidence: based on text extraction quality
    const charCount = text.replace(/\s/g, '').length;
    if (charCount > 500) confidence = 95;
    else if (charCount > 200) confidence = 85;
    else if (charCount > 50) confidence = 60;
    else confidence = 20; // Likely scanned/image PDF — needs OCR
  } catch (err) {
    await audit.logServiceCall(correlationId, 'A1', 'pdf_extract', { error: err.message }, null, Date.now() - start, err.message);
    return { success: false, error: `PDF parse failed: ${err.message}`, confidence: 0, fields: {} };
  }

  // ── Extract fields ──
  const fields = {};

  // Invoice type detection
  const typeMatch = text.match(PATTERNS.invoiceType);
  fields.invoiceType = typeMatch ? normalizeInvoiceType(typeMatch[1]) : 'unknown';

  // GSTINs — find all, classify as vendor vs buyer
  const gstins = [...new Set((text.match(PATTERNS.gstin) || []))];
  fields.allGstins = gstins;
  if (gstins.length >= 2) {
    fields.vendorGstin = gstins[0]; // First GSTIN is usually vendor
    fields.buyerGstin = gstins[1];  // Second is usually buyer
  } else if (gstins.length === 1) {
    fields.vendorGstin = gstins[0];
    fields.buyerGstin = null;
  }

  // Invoice number
  const invMatch = text.match(PATTERNS.invoiceNumber) || text.match(PATTERNS.invoiceNumberAlt);
  fields.invoiceNumber = invMatch ? invMatch[1].trim() : null;

  // Date
  const dateMatch = text.match(PATTERNS.date) || text.match(PATTERNS.dateStandalone);
  fields.invoiceDate = dateMatch ? parseDate(dateMatch[1]) : null;

  // Total amount
  const amtMatch = text.match(PATTERNS.totalAmount);
  fields.totalAmount = amtMatch ? parseAmount(amtMatch[1]) : null;

  // Tax amounts
  const taxMatches = [...text.matchAll(PATTERNS.taxAmount)];
  fields.taxAmounts = taxMatches.map(m => parseAmount(m[1])).filter(a => a > 0);
  fields.totalTax = fields.taxAmounts.reduce((s, a) => s + a, 0);

  // GST type detection (IGST vs CGST+SGST)
  const hasIGST = /igst/i.test(text);
  const hasCGST = /cgst/i.test(text);
  const hasSGST = /sgst/i.test(text);
  fields.gstType = hasIGST ? 'IGST' : (hasCGST && hasSGST) ? 'CGST+SGST' : 'unknown';

  // HSN/SAC
  const hsnMatch = text.match(PATTERNS.hsnSac) || text.match(PATTERNS.hsnSacInTable);
  fields.hsnSac = hsnMatch ? (hsnMatch[1] || hsnMatch[2] || hsnMatch[3]) : null;

  // Place of supply
  const posMatch = text.match(PATTERNS.placeOfSupply);
  fields.placeOfSupply = posMatch ? posMatch[1].trim() : null;

  // PAN
  const panMatch = text.match(PATTERNS.panNumber);
  fields.pan = panMatch ? panMatch[1] : null;

  // Vendor name (first line heuristic)
  const lines = text.split('\n').filter(l => l.trim().length > 3);
  fields.vendorName = lines[0]?.trim() || null;

  // Buyer name
  const buyerMatch = text.match(PATTERNS.buyerName);
  fields.buyerName = buyerMatch ? buyerMatch[1].trim() : null;

  // ── Mandatory field check (Rule 46 CGST) ──
  const mandatoryFields = {
    invoiceNumber: !!fields.invoiceNumber,
    invoiceDate: !!fields.invoiceDate,
    totalAmount: fields.totalAmount > 0,
    vendorGstin: !!fields.vendorGstin,
    hsnSac: !!fields.hsnSac,
    placeOfSupply: !!fields.placeOfSupply,
  };
  const missingMandatory = Object.entries(mandatoryFields).filter(([, v]) => !v).map(([k]) => k);

  // Adjust confidence based on field extraction success
  const extractedCount = Object.values(mandatoryFields).filter(Boolean).length;
  const fieldConfidence = Math.round((extractedCount / 6) * 100);
  confidence = Math.round((confidence + fieldConfidence) / 2);

  const result = {
    success: true,
    confidence,
    pageCount,
    textLength: text.length,
    fields,
    mandatoryFields,
    missingMandatory,
    isComplete: missingMandatory.length === 0,
  };

  await audit.logServiceCall(
    correlationId, 'A1', 'pdf_extract',
    { pageCount, textLength: text.length },
    { confidence, fieldsExtracted: extractedCount, missing: missingMandatory },
    Date.now() - start,
    missingMandatory.length > 0 ? `Missing: ${missingMandatory.join(', ')}` : null
  );

  return result;
}

// ── Helpers ──

function normalizeInvoiceType(raw) {
  const lower = raw.toLowerCase().trim();
  if (lower.includes('tax invoice')) return 'tax_invoice';
  if (lower.includes('proforma')) return 'proforma';
  if (lower.includes('estimate')) return 'estimate';
  if (lower.includes('quotation')) return 'quotation';
  if (lower.includes('delivery note')) return 'delivery_note';
  if (lower.includes('purchase order')) return 'purchase_order';
  if (lower.includes('credit note')) return 'credit_note';
  if (lower.includes('debit note')) return 'debit_note';
  return 'unknown';
}

function parseDate(raw) {
  if (!raw) return null;
  // Handle DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY
  const parts = raw.split(/[\-\/\.]/);
  if (parts.length !== 3) return null;
  let [d, m, y] = parts.map(Number);
  if (y < 100) y += 2000;
  if (m > 12) [d, m] = [m, d]; // Swap if month > 12
  try {
    const date = new Date(y, m - 1, d);
    return date.toISOString().split('T')[0];
  } catch { return null; }
}

function parseAmount(raw) {
  if (!raw) return 0;
  return parseFloat(raw.replace(/,/g, '')) || 0;
}

module.exports = { extract };
