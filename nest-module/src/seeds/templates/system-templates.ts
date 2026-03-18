/**
 * System template seed data - prebuilt templates seeded on first deploy.
 * All have orgId: null (system templates, visible to all orgs).
 * Uses deterministic IDs (sys-*) so they can be upserted idempotently.
 * Includes 9 A4 document templates and 4 label templates.
 */

export interface SystemTemplateSeed {
  id: string;
  type: string;
  name: string;
  schema: Record<string, unknown>;
}

const A4_WIDTH = 210;
const A4_HEIGHT = 297;

function makeBlankSchema(elements: Record<string, unknown>[] = []): Record<string, unknown> {
  return {
    basePdf: { width: A4_WIDTH, height: A4_HEIGHT, padding: [10, 10, 10, 10] },
    schemas: [elements],
    columns: [],
    sampledata: [{}],
  };
}

function makeLabelSchema(
  widthMm: number,
  heightMm: number,
  elements: Record<string, unknown>[] = [],
): Record<string, unknown> {
  return {
    basePdf: { width: widthMm, height: heightMm, padding: [2, 2, 2, 2] },
    schemas: [elements],
    columns: [],
    sampledata: [{}],
  };
}

export const systemTemplates: SystemTemplateSeed[] = [
  {
    id: 'sys-invoice-standard',
    type: 'invoice',
    name: 'Invoice - Standard',
    schema: makeBlankSchema([
      { companyName: { type: 'text', position: { x: 10, y: 10 }, width: 100, height: 10, fontSize: 16, fontWeight: 'bold' } },
      { companyLogo: { type: 'image', position: { x: 160, y: 10 }, width: 40, height: 20 } },
      { invoiceNumber: { type: 'text', position: { x: 10, y: 35 }, width: 80, height: 8 } },
      { invoiceDate: { type: 'text', position: { x: 100, y: 35 }, width: 50, height: 8 } },
      { customerName: { type: 'text', position: { x: 10, y: 50 }, width: 100, height: 8 } },
      { customerAddress: { type: 'text', position: { x: 10, y: 58 }, width: 100, height: 20 } },
      { lineItems: { type: 'table', position: { x: 10, y: 85 }, width: 190, height: 150, columns: ['description', 'qty', 'unitPrice', 'vatRate', 'total'] } },
      { subtotal: { type: 'text', position: { x: 140, y: 240 }, width: 60, height: 8 } },
      { vatSummary: { type: 'text', position: { x: 140, y: 248 }, width: 60, height: 8 } },
      { grandTotal: { type: 'text', position: { x: 140, y: 258 }, width: 60, height: 10, fontSize: 14, fontWeight: 'bold' } },
    ]),
  },
  {
    id: 'sys-invoice-simple',
    type: 'invoice',
    name: 'Invoice - Simple',
    schema: makeBlankSchema([
      { invoiceTitle: { type: 'text', position: { x: 10, y: 10 }, width: 100, height: 12, fontSize: 18, fontWeight: 'bold' } },
      { invoiceNumber: { type: 'text', position: { x: 10, y: 28 }, width: 80, height: 8 } },
      { invoiceDate: { type: 'text', position: { x: 100, y: 28 }, width: 50, height: 8 } },
      { customerName: { type: 'text', position: { x: 10, y: 42 }, width: 100, height: 8 } },
      { lineItems: { type: 'table', position: { x: 10, y: 60 }, width: 190, height: 170, columns: ['description', 'qty', 'price', 'total'] } },
      { total: { type: 'text', position: { x: 140, y: 240 }, width: 60, height: 10, fontSize: 14, fontWeight: 'bold' } },
    ]),
  },
  {
    id: 'sys-statement-account',
    type: 'statement',
    name: 'Statement of Account',
    schema: makeBlankSchema([
      { companyName: { type: 'text', position: { x: 10, y: 10 }, width: 100, height: 10, fontSize: 16, fontWeight: 'bold' } },
      { statementDate: { type: 'text', position: { x: 140, y: 10 }, width: 60, height: 8 } },
      { customerName: { type: 'text', position: { x: 10, y: 30 }, width: 100, height: 8 } },
      { customerAddress: { type: 'text', position: { x: 10, y: 38 }, width: 100, height: 20 } },
      { balanceBroughtForward: { type: 'text', position: { x: 10, y: 65 }, width: 80, height: 8 } },
      { transactions: { type: 'table', position: { x: 10, y: 80 }, width: 190, height: 160, columns: ['date', 'reference', 'description', 'debit', 'credit', 'balance'] } },
      { balanceCarriedForward: { type: 'text', position: { x: 140, y: 250 }, width: 60, height: 10, fontSize: 14, fontWeight: 'bold' } },
    ]),
  },
  {
    id: 'sys-purchase-order',
    type: 'purchase_order',
    name: 'Purchase Order - Standard',
    schema: makeBlankSchema([
      { companyName: { type: 'text', position: { x: 10, y: 10 }, width: 100, height: 10, fontSize: 16, fontWeight: 'bold' } },
      { poNumber: { type: 'text', position: { x: 140, y: 10 }, width: 60, height: 8 } },
      { poDate: { type: 'text', position: { x: 140, y: 20 }, width: 60, height: 8 } },
      { supplierName: { type: 'text', position: { x: 10, y: 30 }, width: 100, height: 8 } },
      { deliveryAddress: { type: 'text', position: { x: 10, y: 45 }, width: 100, height: 20 } },
      { lineItems: { type: 'table', position: { x: 10, y: 75 }, width: 190, height: 150, columns: ['description', 'qty', 'unitPrice', 'total'] } },
      { terms: { type: 'text', position: { x: 10, y: 235 }, width: 190, height: 20 } },
      { total: { type: 'text', position: { x: 140, y: 260 }, width: 60, height: 10, fontSize: 14, fontWeight: 'bold' } },
    ]),
  },
  {
    id: 'sys-delivery-note',
    type: 'delivery_note',
    name: 'Delivery Note',
    schema: makeBlankSchema([
      { companyName: { type: 'text', position: { x: 10, y: 10 }, width: 100, height: 10, fontSize: 16, fontWeight: 'bold' } },
      { deliveryNoteNumber: { type: 'text', position: { x: 140, y: 10 }, width: 60, height: 8 } },
      { deliveryDate: { type: 'text', position: { x: 140, y: 20 }, width: 60, height: 8 } },
      { customerName: { type: 'text', position: { x: 10, y: 30 }, width: 100, height: 8 } },
      { deliveryAddress: { type: 'text', position: { x: 10, y: 40 }, width: 100, height: 20 } },
      { lineItems: { type: 'table', position: { x: 10, y: 70 }, width: 190, height: 180, columns: ['description', 'qty'] } },
      { receivedBy: { type: 'text', position: { x: 10, y: 260 }, width: 80, height: 8 } },
      { signature: { type: 'image', position: { x: 100, y: 255 }, width: 50, height: 20 } },
    ]),
  },
  {
    id: 'sys-credit-note',
    type: 'credit_note',
    name: 'Credit Note - Standard',
    schema: makeBlankSchema([
      { companyName: { type: 'text', position: { x: 10, y: 10 }, width: 100, height: 10, fontSize: 16, fontWeight: 'bold' } },
      { creditNoteNumber: { type: 'text', position: { x: 140, y: 10 }, width: 60, height: 8 } },
      { creditNoteDate: { type: 'text', position: { x: 140, y: 20 }, width: 60, height: 8 } },
      { originalInvoiceRef: { type: 'text', position: { x: 10, y: 30 }, width: 100, height: 8 } },
      { customerName: { type: 'text', position: { x: 10, y: 42 }, width: 100, height: 8 } },
      { lineItems: { type: 'table', position: { x: 10, y: 60 }, width: 190, height: 160, columns: ['description', 'qty', 'unitPrice', 'vatRate', 'total'] } },
      { creditTotal: { type: 'text', position: { x: 140, y: 230 }, width: 60, height: 10, fontSize: 14, fontWeight: 'bold' } },
    ]),
  },
  {
    id: 'sys-report-aged-debtors',
    type: 'report_aged_debtors',
    name: 'Report - Aged Debtors',
    schema: makeBlankSchema([
      { reportTitle: { type: 'text', position: { x: 10, y: 10 }, width: 120, height: 12, fontSize: 18, fontWeight: 'bold' } },
      { reportDate: { type: 'text', position: { x: 140, y: 10 }, width: 60, height: 8 } },
      { debtorsTable: { type: 'table', position: { x: 10, y: 30 }, width: 190, height: 220, columns: ['customer', 'current', '30days', '60days', '90days', '120plus', 'total'] } },
      { grandTotal: { type: 'text', position: { x: 140, y: 260 }, width: 60, height: 10, fontSize: 14, fontWeight: 'bold' } },
    ]),
  },
  {
    id: 'sys-report-stock-on-hand',
    type: 'report_stock_on_hand',
    name: 'Report - Stock on Hand',
    schema: makeBlankSchema([
      { reportTitle: { type: 'text', position: { x: 10, y: 10 }, width: 120, height: 12, fontSize: 18, fontWeight: 'bold' } },
      { reportDate: { type: 'text', position: { x: 140, y: 10 }, width: 60, height: 8 } },
      { stockTable: { type: 'table', position: { x: 10, y: 30 }, width: 190, height: 230, columns: ['category', 'itemCode', 'description', 'qty', 'value', 'reorderFlag'] } },
      { totalValue: { type: 'text', position: { x: 140, y: 268 }, width: 60, height: 10, fontSize: 14, fontWeight: 'bold' } },
    ]),
  },
  {
    id: 'sys-report-sales-summary',
    type: 'report_sales_summary',
    name: 'Report - Sales Summary',
    schema: makeBlankSchema([
      { reportTitle: { type: 'text', position: { x: 10, y: 10 }, width: 120, height: 12, fontSize: 18, fontWeight: 'bold' } },
      { dateRange: { type: 'text', position: { x: 140, y: 10 }, width: 60, height: 8 } },
      { salesTable: { type: 'table', position: { x: 10, y: 30 }, width: 190, height: 230, columns: ['customer', 'product', 'qty', 'revenue', 'cost', 'margin'] } },
      { totalRevenue: { type: 'text', position: { x: 140, y: 268 }, width: 60, height: 10, fontSize: 14, fontWeight: 'bold' } },
    ]),
  },

  // ── Label Templates ──────────────────────────────────────────────────

  {
    id: 'sys-label-shipping',
    type: 'label',
    name: 'Shipping Label',
    schema: makeLabelSchema(101.6, 152.4, [
      { companyLogo: { type: 'image', position: { x: 2, y: 2 }, width: 25, height: 12 } },
      { senderAddress: { type: 'text', position: { x: 30, y: 2 }, width: 69.6, height: 18, fontSize: 7 } },
      { recipientName: { type: 'text', position: { x: 2, y: 28 }, width: 97.6, height: 8, fontSize: 12, fontWeight: 'bold' } },
      { recipientAddress: { type: 'text', position: { x: 2, y: 38 }, width: 97.6, height: 30, fontSize: 10 } },
      { trackingBarcode: { type: 'code128', position: { x: 2, y: 78 }, width: 97.6, height: 20 } },
      { trackingNumber: { type: 'text', position: { x: 2, y: 100 }, width: 60, height: 6, fontSize: 8 } },
      { trackingQr: { type: 'qrcode', position: { x: 72, y: 100 }, width: 27.6, height: 27.6 } },
      { shipDate: { type: 'text', position: { x: 2, y: 135 }, width: 40, height: 6, fontSize: 7 } },
      { serviceType: { type: 'text', position: { x: 45, y: 135 }, width: 54.6, height: 6, fontSize: 7 } },
    ]),
  },
  {
    id: 'sys-label-product',
    type: 'label',
    name: 'Product Label',
    schema: makeLabelSchema(102, 64, [
      { companyLogo: { type: 'image', position: { x: 2, y: 2 }, width: 20, height: 10 } },
      { productName: { type: 'text', position: { x: 24, y: 2 }, width: 76, height: 10, fontSize: 11, fontWeight: 'bold' } },
      { description: { type: 'text', position: { x: 2, y: 14 }, width: 98, height: 12, fontSize: 7 } },
      { price: { type: 'text', position: { x: 2, y: 30 }, width: 40, height: 10, fontSize: 14, fontWeight: 'bold' } },
      { skuBarcode: { type: 'code128', position: { x: 2, y: 44 }, width: 70, height: 16 } },
      { skuText: { type: 'text', position: { x: 74, y: 48 }, width: 26, height: 6, fontSize: 7 } },
    ]),
  },
  {
    id: 'sys-label-asset-tag',
    type: 'label',
    name: 'Asset Tag',
    schema: makeLabelSchema(76, 51, [
      { assetIdBarcode: { type: 'code128', position: { x: 2, y: 2 }, width: 50, height: 14 } },
      { assetQr: { type: 'qrcode', position: { x: 54, y: 2 }, width: 20, height: 20 } },
      { assetName: { type: 'text', position: { x: 2, y: 20 }, width: 72, height: 8, fontSize: 10, fontWeight: 'bold' } },
      { assetId: { type: 'text', position: { x: 2, y: 30 }, width: 40, height: 6, fontSize: 8 } },
      { department: { type: 'text', position: { x: 2, y: 38 }, width: 72, height: 6, fontSize: 8 } },
      { tagDate: { type: 'text', position: { x: 50, y: 44 }, width: 24, height: 5, fontSize: 6 } },
    ]),
  },
  {
    id: 'sys-label-shelf',
    type: 'label',
    name: 'Shelf Label',
    schema: makeLabelSchema(80, 40, [
      { productName: { type: 'text', position: { x: 2, y: 2 }, width: 76, height: 7, fontSize: 9, fontWeight: 'bold' } },
      { price: { type: 'text', position: { x: 2, y: 10 }, width: 45, height: 14, fontSize: 20, fontWeight: 'bold' } },
      { sku: { type: 'text', position: { x: 50, y: 12 }, width: 28, height: 6, fontSize: 7 } },
      { barcode: { type: 'code128', position: { x: 2, y: 26 }, width: 76, height: 12 } },
    ]),
  },
];
