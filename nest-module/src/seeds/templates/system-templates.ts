/**
 * System template seed data - 9 prebuilt templates seeded on first deploy.
 * All have orgId: null (system templates, visible to all orgs).
 * Uses deterministic IDs (sys-*) so they can be upserted idempotently.
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
];
