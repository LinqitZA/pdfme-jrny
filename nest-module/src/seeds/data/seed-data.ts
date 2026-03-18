/**
 * Comprehensive ERP Seed Data - South African flavoured test data
 * for all system template types.
 *
 * All monetary values in ZAR, addresses in SA format, VAT at 15%.
 * Deterministic IDs (seed-*) for idempotent seeding.
 */

// ── ORGANISATIONS ──────────────────────────────────────────────────────

export interface SeedOrganisation {
  id: string;
  name: string;
  regNumber: string;
  vatNumber: string;
  address: string;
  city: string;
  postalCode: string;
  phone: string;
  email: string;
}

export const seedOrganisations: SeedOrganisation[] = [
  {
    id: 'seed-org-alpha',
    name: 'Alpha Trading (Pty) Ltd',
    regNumber: '2019/234567/07',
    vatNumber: '4234567891',
    address: '42 Rivonia Blvd, Sandton',
    city: 'Johannesburg',
    postalCode: '2196',
    phone: '+27 11 555 0001',
    email: 'info@alphatrading.co.za',
  },
  {
    id: 'seed-org-beta',
    name: 'Beta Manufacturing (Pty) Ltd',
    regNumber: '2021/876543/07',
    vatNumber: '4876543210',
    address: '15 Voortrekker Rd, Bellville',
    city: 'Cape Town',
    postalCode: '7530',
    phone: '+27 21 555 0002',
    email: 'info@betamfg.co.za',
  },
];

// ── CUSTOMERS ──────────────────────────────────────────────────────────

export interface SeedCustomer {
  id: string;
  orgId: string;
  accountCode: string;
  name: string;
  email: string;
  phone: string;
  vatNumber: string;
  address: string;
  city: string;
  postalCode: string;
}

export const seedCustomers: SeedCustomer[] = [
  {
    id: 'seed-cust-001',
    orgId: 'seed-org-alpha',
    accountCode: 'ACC-001',
    name: 'Acme Construction (Pty) Ltd',
    email: 'accounts@acme.co.za',
    phone: '+27 11 555 1234',
    vatNumber: '4111222333',
    address: '88 Commissioner St',
    city: 'Johannesburg',
    postalCode: '2001',
  },
  {
    id: 'seed-cust-002',
    orgId: 'seed-org-alpha',
    accountCode: 'ACC-002',
    name: 'Protea Retailers CC',
    email: 'finance@protea.co.za',
    phone: '+27 21 555 5678',
    vatNumber: '4444555666',
    address: '23 Long St',
    city: 'Cape Town',
    postalCode: '8001',
  },
  {
    id: 'seed-cust-003',
    orgId: 'seed-org-alpha',
    accountCode: 'ACC-003',
    name: 'Jacaranda Logistics (Pty) Ltd',
    email: 'ap@jacaranda.co.za',
    phone: '+27 12 555 9012',
    vatNumber: '',
    address: '7 Church St',
    city: 'Pretoria',
    postalCode: '0002',
  },
  {
    id: 'seed-cust-004',
    orgId: 'seed-org-alpha',
    accountCode: 'ACC-004',
    name: 'Karoo Farming Co-op',
    email: 'admin@karoo.co.za',
    phone: '+27 53 555 3456',
    vatNumber: '4777888999',
    address: 'Farm 12',
    city: 'Graaff-Reinet',
    postalCode: '6280',
  },
  {
    id: 'seed-cust-005',
    orgId: 'seed-org-alpha',
    accountCode: 'ACC-005',
    name: 'Drakensberg Hotels Group',
    email: 'procurement@drakensberg.co.za',
    phone: '+27 36 555 7890',
    vatNumber: '4000111222',
    address: '1 Cathedral Peak Rd',
    city: 'Winterton',
    postalCode: '3340',
  },
  {
    id: 'seed-cust-006',
    orgId: 'seed-org-beta',
    accountCode: 'ACC-006',
    name: 'Table Mountain Tech (Pty) Ltd',
    email: 'billing@tablemtn.co.za',
    phone: '+27 21 555 2468',
    vatNumber: '4333444555',
    address: '10 Buitengracht St',
    city: 'Cape Town',
    postalCode: '8001',
  },
];

// ── INVOICES ───────────────────────────────────────────────────────────

export interface SeedLineItem {
  description: string;
  qty: number;
  unitPrice: number;
  total: number;
  vatRate?: number;
}

export interface SeedInvoice {
  id: string;
  orgId: string;
  customerId: string;
  number: string;
  date: string;
  dueDate: string;
  reference: string;
  lineItems: SeedLineItem[];
  subtotal: number;
  vatAmount: number;
  total: number;
}

export const seedInvoices: SeedInvoice[] = [
  {
    id: 'seed-inv-001',
    orgId: 'seed-org-alpha',
    customerId: 'seed-cust-001',
    number: 'INV-2026-0042',
    date: '2026-03-15',
    dueDate: '2026-04-14',
    reference: 'PO-AC-789',
    lineItems: [
      { description: 'Cement 50kg bags', qty: 20, unitPrice: 89.50, total: 1790.00, vatRate: 15 },
      { description: 'Structural Steel 6m', qty: 10, unitPrice: 1250.00, total: 12500.00, vatRate: 15 },
      { description: 'River Sand per ton', qty: 5, unitPrice: 450.00, total: 2250.00, vatRate: 15 },
      { description: 'Building Bricks', qty: 2000, unitPrice: 2.85, total: 5700.00, vatRate: 15 },
      { description: 'Roof Tiles', qty: 500, unitPrice: 18.90, total: 9450.00, vatRate: 15 },
    ],
    subtotal: 31690.00,
    vatAmount: 4753.50,
    total: 36443.50,
  },
  {
    id: 'seed-inv-002',
    orgId: 'seed-org-alpha',
    customerId: 'seed-cust-002',
    number: 'INV-2026-0043',
    date: '2026-03-16',
    dueDate: '2026-04-15',
    reference: 'PO-PR-456',
    lineItems: [
      { description: 'POS Display Units', qty: 12, unitPrice: 2400.00, total: 28800.00, vatRate: 15 },
      { description: 'Shelf Brackets', qty: 100, unitPrice: 45.00, total: 4500.00, vatRate: 15 },
      { description: 'LED Light Strips 5m', qty: 24, unitPrice: 189.00, total: 4536.00, vatRate: 15 },
    ],
    subtotal: 37836.00,
    vatAmount: 5675.40,
    total: 43511.40,
  },
  {
    id: 'seed-inv-003',
    orgId: 'seed-org-alpha',
    customerId: 'seed-cust-005',
    number: 'INV-2026-0044',
    date: '2026-03-18',
    dueDate: '2026-04-17',
    reference: 'PO-DH-321',
    lineItems: [
      { description: 'Luxury Bath Towels', qty: 200, unitPrice: 145.00, total: 29000.00, vatRate: 15 },
      { description: 'Pillow Cases 200TC', qty: 500, unitPrice: 38.50, total: 19250.00, vatRate: 15 },
      { description: 'Mini Shampoo 30ml', qty: 1000, unitPrice: 8.50, total: 8500.00, vatRate: 15 },
      { description: 'Room Service Trays', qty: 50, unitPrice: 320.00, total: 16000.00, vatRate: 15 },
    ],
    subtotal: 72750.00,
    vatAmount: 10912.50,
    total: 83662.50,
  },
];

// ── STATEMENTS ─────────────────────────────────────────────────────────

export interface SeedTransaction {
  date: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface SeedAgeing {
  current: number;
  days30: number;
  days60: number;
  days90plus: number;
}

export interface SeedStatement {
  id: string;
  orgId: string;
  customerId: string;
  period: string;
  date: string;
  openingBalance: number;
  closingBalance: number;
  transactions: SeedTransaction[];
  ageing: SeedAgeing;
}

export const seedStatements: SeedStatement[] = [
  {
    id: 'seed-stmt-001',
    orgId: 'seed-org-alpha',
    customerId: 'seed-cust-001',
    period: 'March 2026',
    date: '2026-03-31',
    openingBalance: 45230.00,
    closingBalance: 78023.50,
    transactions: [
      { date: '2026-03-01', reference: 'B/F', description: 'Balance brought forward', debit: 0, credit: 0, balance: 45230.00 },
      { date: '2026-03-05', reference: 'PMT-0312', description: 'Payment received — thank you', debit: 0, credit: 20000.00, balance: 25230.00 },
      { date: '2026-03-10', reference: 'INV-2026-0038', description: 'Building materials — Waterfall site', debit: 18500.00, credit: 0, balance: 43730.00 },
      { date: '2026-03-15', reference: 'INV-2026-0042', description: 'Construction supplies — Site 7', debit: 36443.50, credit: 0, balance: 80173.50 },
      { date: '2026-03-22', reference: 'CN-2026-0005', description: 'Credit note — damaged goods returned', debit: 0, credit: 2150.00, balance: 78023.50 },
    ],
    ageing: { current: 36443.50, days30: 16350.00, days60: 15230.00, days90plus: 10000.00 },
  },
  {
    id: 'seed-stmt-002',
    orgId: 'seed-org-alpha',
    customerId: 'seed-cust-002',
    period: 'March 2026',
    date: '2026-03-31',
    openingBalance: 12800.00,
    closingBalance: 51111.40,
    transactions: [
      { date: '2026-03-01', reference: 'B/F', description: 'Balance brought forward', debit: 0, credit: 0, balance: 12800.00 },
      { date: '2026-03-08', reference: 'PMT-0315', description: 'Payment received', debit: 0, credit: 5200.00, balance: 7600.00 },
      { date: '2026-03-16', reference: 'INV-2026-0043', description: 'POS displays and fittings', debit: 43511.40, credit: 0, balance: 51111.40 },
    ],
    ageing: { current: 43511.40, days30: 4800.00, days60: 2800.00, days90plus: 0 },
  },
];

// ── PURCHASE ORDERS ────────────────────────────────────────────────────

export interface SeedPurchaseOrder {
  id: string;
  orgId: string;
  number: string;
  date: string;
  supplierName: string;
  supplierAddress: string;
  deliveryAddress: string;
  lineItems: SeedLineItem[];
  subtotal: number;
  vatAmount: number;
  total: number;
  terms: string;
}

export const seedPurchaseOrders: SeedPurchaseOrder[] = [
  {
    id: 'seed-po-001',
    orgId: 'seed-org-alpha',
    number: 'PO-2026-0015',
    date: '2026-03-18',
    supplierName: 'Coastal Steel Suppliers',
    supplierAddress: '18 Marine Dr, Durban, 4001',
    deliveryAddress: '42 Rivonia Blvd, Sandton, Johannesburg, 2196',
    lineItems: [
      { description: 'Galvanised Pipe 50mm', qty: 30, unitPrice: 890.00, total: 26700.00 },
      { description: 'Flat Bar 40x3mm', qty: 50, unitPrice: 125.00, total: 6250.00 },
      { description: 'Welding Rods 2.5mm 5kg', qty: 10, unitPrice: 185.00, total: 1850.00 },
    ],
    subtotal: 34800.00,
    vatAmount: 5220.00,
    total: 40020.00,
    terms: 'Payment 30 days from date of invoice. Delivery to warehouse — no site deliveries.',
  },
  {
    id: 'seed-po-002',
    orgId: 'seed-org-alpha',
    number: 'PO-2026-0016',
    date: '2026-03-18',
    supplierName: 'Highveld Chemicals',
    supplierAddress: '5 Industrial Rd, Midrand, 1685',
    deliveryAddress: '42 Rivonia Blvd, Sandton, Johannesburg, 2196',
    lineItems: [
      { description: 'Cleaning Solution 25L', qty: 20, unitPrice: 310.00, total: 6200.00 },
      { description: 'Sanitiser 5L', qty: 50, unitPrice: 89.00, total: 4450.00 },
    ],
    subtotal: 10650.00,
    vatAmount: 1597.50,
    total: 12247.50,
    terms: 'COD. Hazardous materials — MSDS included.',
  },
];

// ── DELIVERY NOTE ──────────────────────────────────────────────────────

export interface SeedDeliveryNote {
  id: string;
  orgId: string;
  number: string;
  date: string;
  invoiceRef: string;
  customerId: string;
  deliveryAddress: string;
  driver: string;
  vehicle: string;
  lineItems: { description: string; qty: number }[];
}

export const seedDeliveryNotes: SeedDeliveryNote[] = [
  {
    id: 'seed-dn-001',
    orgId: 'seed-org-alpha',
    number: 'DN-2026-0033',
    date: '2026-03-18',
    invoiceRef: 'INV-2026-0042',
    customerId: 'seed-cust-001',
    deliveryAddress: 'Site 7, Waterfall Estate, Midrand, 1685',
    driver: 'T. Nkosi',
    vehicle: 'NP300 — GP 456-789',
    lineItems: [
      { description: 'Cement 50kg bags', qty: 20 },
      { description: 'Structural Steel 6m', qty: 10 },
      { description: 'River Sand per ton', qty: 5 },
      { description: 'Building Bricks', qty: 2000 },
      { description: 'Roof Tiles', qty: 500 },
    ],
  },
];

// ── CREDIT NOTE ────────────────────────────────────────────────────────

export interface SeedCreditNote {
  id: string;
  orgId: string;
  number: string;
  date: string;
  invoiceRef: string;
  customerId: string;
  reason: string;
  lineItems: SeedLineItem[];
  subtotal: number;
  vatAmount: number;
  total: number;
}

export const seedCreditNotes: SeedCreditNote[] = [
  {
    id: 'seed-cn-001',
    orgId: 'seed-org-alpha',
    number: 'CN-2026-0012',
    date: '2026-03-17',
    invoiceRef: 'INV-2026-0038',
    customerId: 'seed-cust-001',
    reason: 'Damaged goods returned',
    lineItems: [
      { description: 'Cement 50kg bags', qty: 3, unitPrice: 89.50, total: 268.50, vatRate: 15 },
      { description: 'Building Bricks', qty: 500, unitPrice: 2.85, total: 1425.00, vatRate: 15 },
    ],
    subtotal: 1693.50,
    vatAmount: 254.03,
    total: 1947.53,
  },
];

// ── AGED DEBTORS REPORT ────────────────────────────────────────────────

export interface SeedAgedDebtor {
  customerId: string;
  customerName: string;
  accountCode: string;
  current: number;
  days30: number;
  days60: number;
  days90: number;
  days120plus: number;
  total: number;
}

export interface SeedAgedDebtorsReport {
  id: string;
  orgId: string;
  reportDate: string;
  title: string;
  debtors: SeedAgedDebtor[];
  grandTotal: number;
}

export const seedAgedDebtorsReport: SeedAgedDebtorsReport = {
  id: 'seed-report-aged-debtors',
  orgId: 'seed-org-alpha',
  reportDate: '2026-03-18',
  title: 'Aged Debtors Analysis',
  debtors: [
    { customerId: 'seed-cust-001', customerName: 'Acme Construction (Pty) Ltd', accountCode: 'ACC-001', current: 78023.50, days30: 16350.00, days60: 15230.00, days90: 10000.00, days120plus: 5200.00, total: 124803.50 },
    { customerId: 'seed-cust-002', customerName: 'Protea Retailers CC', accountCode: 'ACC-002', current: 43511.40, days30: 4800.00, days60: 2800.00, days90: 0, days120plus: 0, total: 51111.40 },
    { customerId: 'seed-cust-003', customerName: 'Jacaranda Logistics (Pty) Ltd', accountCode: 'ACC-003', current: 12500.00, days30: 8200.00, days60: 3100.00, days90: 1500.00, days120plus: 0, total: 25300.00 },
    { customerId: 'seed-cust-004', customerName: 'Karoo Farming Co-op', accountCode: 'ACC-004', current: 3200.00, days30: 5600.00, days60: 8900.00, days90: 18500.00, days120plus: 12315.10, total: 48515.10 },
    { customerId: 'seed-cust-005', customerName: 'Drakensberg Hotels Group', accountCode: 'ACC-005', current: 25000.00, days30: 4500.00, days60: 2000.00, days90: 0, days120plus: 0, total: 31500.00 },
    { customerId: 'seed-cust-006', customerName: 'Table Mountain Tech (Pty) Ltd', accountCode: 'ACC-006', current: 2500.00, days30: 1000.00, days60: 500.00, days90: 0, days120plus: 500.00, total: 4500.00 },
  ],
  grandTotal: 285730.00,
};

// ── STOCK ON HAND REPORT ───────────────────────────────────────────────

export interface SeedStockItem {
  itemCode: string;
  description: string;
  category: string;
  warehouse: string;
  qtyOnHand: number;
  qtyReserved: number;
  qtyAvailable: number;
  unitCost: number;
  totalValue: number;
}

export interface SeedStockReport {
  id: string;
  orgId: string;
  reportDate: string;
  title: string;
  items: SeedStockItem[];
  grandTotalValue: number;
}

export const seedStockReport: SeedStockReport = {
  id: 'seed-report-stock',
  orgId: 'seed-org-alpha',
  reportDate: '2026-03-18',
  title: 'Stock on Hand Report',
  items: [
    // Building Materials
    { itemCode: 'BM-CEM-50', description: 'Cement 50kg bags', category: 'Building Materials', warehouse: 'JHB-WH1', qtyOnHand: 450, qtyReserved: 80, qtyAvailable: 370, unitCost: 78.00, totalValue: 35100.00 },
    { itemCode: 'BM-STL-6M', description: 'Structural Steel 6m IPE200', category: 'Building Materials', warehouse: 'JHB-WH1', qtyOnHand: 120, qtyReserved: 35, qtyAvailable: 85, unitCost: 1100.00, totalValue: 132000.00 },
    { itemCode: 'BM-SND-01', description: 'River Sand (per ton)', category: 'Building Materials', warehouse: 'JHB-WH1', qtyOnHand: 85, qtyReserved: 20, qtyAvailable: 65, unitCost: 380.00, totalValue: 32300.00 },
    { itemCode: 'BM-BRK-01', description: 'Building Bricks (NFP)', category: 'Building Materials', warehouse: 'CPT-WH2', qtyOnHand: 25000, qtyReserved: 8000, qtyAvailable: 17000, unitCost: 2.20, totalValue: 55000.00 },
    // Hardware
    { itemCode: 'HW-PIP-50', description: 'Galvanised Pipe 50mm 6m', category: 'Hardware', warehouse: 'JHB-WH1', qtyOnHand: 200, qtyReserved: 60, qtyAvailable: 140, unitCost: 780.00, totalValue: 156000.00 },
    { itemCode: 'HW-FLT-40', description: 'Flat Bar 40x3mm 6m', category: 'Hardware', warehouse: 'JHB-WH1', qtyOnHand: 350, qtyReserved: 100, qtyAvailable: 250, unitCost: 105.00, totalValue: 36750.00 },
    { itemCode: 'HW-RTL-01', description: 'Roof Tiles — Marley Double Roman', category: 'Hardware', warehouse: 'CPT-WH2', qtyOnHand: 8500, qtyReserved: 2000, qtyAvailable: 6500, unitCost: 16.50, totalValue: 140250.00 },
    // Consumables
    { itemCode: 'CN-WLD-25', description: 'Welding Rods 2.5mm 5kg', category: 'Consumables', warehouse: 'JHB-WH1', qtyOnHand: 45, qtyReserved: 15, qtyAvailable: 30, unitCost: 155.00, totalValue: 6975.00 },
    { itemCode: 'CN-CLN-25', description: 'Industrial Cleaning Solution 25L', category: 'Consumables', warehouse: 'JHB-WH1', qtyOnHand: 0, qtyReserved: 0, qtyAvailable: 0, unitCost: 265.00, totalValue: 0 },
    { itemCode: 'CN-SAN-05', description: 'Hand Sanitiser 5L', category: 'Consumables', warehouse: 'CPT-WH2', qtyOnHand: 30, qtyReserved: 45, qtyAvailable: -15, unitCost: 75.50, totalValue: 2265.00 },
  ],
  grandTotalValue: 596640.00,
};

// ── SALES SUMMARY REPORT ──────────────────────────────────────────────

export interface SeedSalesRepMonth {
  month: string;
  revenue: number;
  qty: number;
  marginPct: number;
}

export interface SeedSalesRep {
  name: string;
  months: SeedSalesRepMonth[];
  ytdRevenue: number;
  ytdQty: number;
  ytdMarginPct: number;
  budgetVariancePct: number;
}

export interface SeedSalesReport {
  id: string;
  orgId: string;
  title: string;
  dateRange: string;
  reps: SeedSalesRep[];
  ytdTotalRevenue: number;
  ytdTotalQty: number;
}

export const seedSalesReport: SeedSalesReport = {
  id: 'seed-report-sales',
  orgId: 'seed-org-alpha',
  title: 'Monthly Sales Summary',
  dateRange: 'January – March 2026',
  reps: [
    {
      name: 'S. Molefe',
      months: [
        { month: 'Jan 2026', revenue: 185000.00, qty: 342, marginPct: 28.5 },
        { month: 'Feb 2026', revenue: 210500.00, qty: 415, marginPct: 31.2 },
        { month: 'Mar 2026', revenue: 198750.00, qty: 378, marginPct: 29.8 },
      ],
      ytdRevenue: 594250.00,
      ytdQty: 1135,
      ytdMarginPct: 29.8,
      budgetVariancePct: 4.2,
    },
    {
      name: 'J. van der Merwe',
      months: [
        { month: 'Jan 2026', revenue: 142000.00, qty: 267, marginPct: 25.1 },
        { month: 'Feb 2026', revenue: 168300.00, qty: 312, marginPct: 27.6 },
        { month: 'Mar 2026', revenue: 155800.00, qty: 289, marginPct: 26.3 },
      ],
      ytdRevenue: 466100.00,
      ytdQty: 868,
      ytdMarginPct: 26.3,
      budgetVariancePct: -2.8,
    },
    {
      name: 'A. Pillay',
      months: [
        { month: 'Jan 2026', revenue: 225000.00, qty: 450, marginPct: 33.4 },
        { month: 'Feb 2026', revenue: 248900.00, qty: 498, marginPct: 35.1 },
        { month: 'Mar 2026', revenue: 231650.00, qty: 462, marginPct: 34.0 },
      ],
      ytdRevenue: 705550.00,
      ytdQty: 1410,
      ytdMarginPct: 34.2,
      budgetVariancePct: 8.5,
    },
  ],
  ytdTotalRevenue: 1765900.00,
  ytdTotalQty: 3413,
};

// ── LABEL SEED DATA ────────────────────────────────────────────────────

export interface SeedShippingLabel {
  id: string;
  recipientName: string;
  recipientAddress: string;
  senderAddress: string;
  trackingNumber: string;
  weight: string;
  pallets: string;
  shipDate: string;
  serviceType: string;
}

export const seedShippingLabel: SeedShippingLabel = {
  id: 'seed-label-shipping',
  recipientName: 'Acme Construction (Pty) Ltd',
  recipientAddress: 'Site 7, Waterfall Estate\nMidrand, 1685\nGauteng, South Africa',
  senderAddress: 'Alpha Trading (Pty) Ltd\n42 Rivonia Blvd\nSandton, 2196',
  trackingNumber: 'TRK-2026-03-18-0042',
  weight: '1,250 kg',
  pallets: '3/5 pallets',
  shipDate: '2026-03-18',
  serviceType: 'Express — Next Day',
};

export interface SeedProductLabel {
  id: string;
  productName: string;
  description: string;
  itemCode: string;
  barcode: string;
  batch: string;
  price: string;
}

export const seedProductLabel: SeedProductLabel = {
  id: 'seed-label-product',
  productName: 'Structural Steel 6m IPE200',
  description: 'Hot-rolled IPE200 profile, 6m length. Grade S355JR. Mill cert included.',
  itemCode: 'STL-IPE200-6M',
  barcode: '6001234567890',
  batch: 'B2026-0318',
  price: 'R 1,250.00 excl. VAT',
};

export interface SeedAssetTag {
  id: string;
  assetName: string;
  assetId: string;
  serialNumber: string;
  department: string;
  location: string;
  tagDate: string;
}

export const seedAssetTag: SeedAssetTag = {
  id: 'seed-label-asset-tag',
  assetName: 'Dell Latitude 5540',
  assetId: 'ASSET-2026-0147',
  serialNumber: 'DLATX-7K9M2',
  department: 'IT',
  location: 'JHB-HQ-3F',
  tagDate: '2026-03-18',
};

export interface SeedShelfLabel {
  id: string;
  productName: string;
  price: string;
  sku: string;
  bin: string;
  reorderLevel: number;
  currentStock: number;
  barcode: string;
}

export const seedShelfLabel: SeedShelfLabel = {
  id: 'seed-label-shelf',
  productName: 'Galvanised Pipe 50mm',
  price: 'R 890.00',
  sku: 'HW-PIP-50',
  bin: 'LOC-A3-R2-S4',
  reorderLevel: 15,
  currentStock: 42,
  barcode: '6009876543210',
};

// ── TEMPLATE-TO-INPUT MAPPING ──────────────────────────────────────────
// Maps template types to the flat inputs Record<string, string> expected by pdfme.

/** Format ZAR currency: R 1,250.00 (comma thousands, period decimal) */
function formatZAR(amount: number): string {
  return `R ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Returns the appropriate seed input data for a given template type.
 * Each returns Record<string, string> suitable for pdfme render inputs.
 *
 * Table inputs are serialised as JSON 2D string arrays matching the column
 * order defined in the system template schemas (pdfme table format).
 */
export function getSeedInputsForTemplate(templateType: string): Record<string, string> {
  switch (templateType) {
    case 'invoice': {
      const inv = seedInvoices[0];
      const cust = seedCustomers.find(c => c.id === inv.customerId)!;
      const org = seedOrganisations[0];
      // sys-invoice-standard columns: description, qty, unitPrice, vatRate, total
      // sys-invoice-simple  columns: description, qty, price, total
      const tableRows = inv.lineItems.map(li => [
        li.description,
        String(li.qty),
        formatZAR(li.unitPrice),
        '15%',
        formatZAR(li.total),
      ]);
      return {
        'companyName': org.name,
        'invoiceNumber': inv.number,
        'invoiceDate': inv.date,
        'invoiceTitle': 'TAX INVOICE',
        'customerName': cust.name,
        'customerAddress': `${cust.address}\n${cust.city}, ${cust.postalCode}\nVAT: ${cust.vatNumber}`,
        'subtotal': formatZAR(inv.subtotal),
        'vatSummary': `VAT @ 15%: ${formatZAR(inv.vatAmount)}`,
        'grandTotal': formatZAR(inv.total),
        'total': formatZAR(inv.total),
        'lineItems': JSON.stringify(tableRows),
      };
    }

    case 'statement': {
      const stmt = seedStatements[0];
      const cust = seedCustomers.find(c => c.id === stmt.customerId)!;
      const org = seedOrganisations[0];
      // columns: date, reference, description, debit, credit, balance
      const tableRows = stmt.transactions.map(t => [
        t.date,
        t.reference,
        t.description,
        t.debit ? formatZAR(t.debit) : '',
        t.credit ? formatZAR(t.credit) : '',
        formatZAR(t.balance),
      ]);
      return {
        'companyName': org.name,
        'statementDate': stmt.date,
        'customerName': cust.name,
        'customerAddress': `${cust.address}\n${cust.city}, ${cust.postalCode}`,
        'balanceBroughtForward': `Balance B/F: ${formatZAR(stmt.openingBalance)}`,
        'balanceCarriedForward': formatZAR(stmt.closingBalance),
        'transactions': JSON.stringify(tableRows),
      };
    }

    case 'purchase_order': {
      const po = seedPurchaseOrders[0];
      const org = seedOrganisations[0];
      // columns: description, qty, unitPrice, total
      const tableRows = po.lineItems.map(li => [
        li.description,
        String(li.qty),
        formatZAR(li.unitPrice),
        formatZAR(li.total),
      ]);
      return {
        'companyName': org.name,
        'poNumber': po.number,
        'poDate': po.date,
        'supplierName': po.supplierName,
        'deliveryAddress': po.deliveryAddress,
        'terms': po.terms,
        'total': formatZAR(po.total),
        'lineItems': JSON.stringify(tableRows),
      };
    }

    case 'delivery_note': {
      const dn = seedDeliveryNotes[0];
      const cust = seedCustomers.find(c => c.id === dn.customerId)!;
      const org = seedOrganisations[0];
      // columns: description, qty
      const tableRows = dn.lineItems.map(li => [li.description, String(li.qty)]);
      return {
        'companyName': org.name,
        'deliveryNoteNumber': dn.number,
        'deliveryDate': dn.date,
        'customerName': cust.name,
        'deliveryAddress': dn.deliveryAddress,
        'receivedBy': `Driver: ${dn.driver} | Vehicle: ${dn.vehicle}`,
        'lineItems': JSON.stringify(tableRows),
      };
    }

    case 'credit_note': {
      const cn = seedCreditNotes[0];
      const cust = seedCustomers.find(c => c.id === cn.customerId)!;
      const org = seedOrganisations[0];
      // columns: description, qty, unitPrice, vatRate, total
      const tableRows = cn.lineItems.map(li => [
        li.description,
        String(li.qty),
        formatZAR(li.unitPrice),
        '15%',
        formatZAR(li.total),
      ]);
      return {
        'companyName': org.name,
        'creditNoteNumber': cn.number,
        'creditNoteDate': cn.date,
        'originalInvoiceRef': `Ref: ${cn.invoiceRef} — ${cn.reason}`,
        'customerName': cust.name,
        'creditTotal': formatZAR(cn.total),
        'lineItems': JSON.stringify(tableRows),
      };
    }

    case 'report_aged_debtors': {
      const report = seedAgedDebtorsReport;
      // columns: customer, current, 30days, 60days, 90days, 120plus, total
      const tableRows = report.debtors.map(d => [
        `${d.customerName} (${d.accountCode})`,
        formatZAR(d.current),
        formatZAR(d.days30),
        formatZAR(d.days60),
        formatZAR(d.days90),
        formatZAR(d.days120plus),
        formatZAR(d.total),
      ]);
      return {
        'reportTitle': report.title,
        'reportDate': report.reportDate,
        'grandTotal': formatZAR(report.grandTotal),
        'debtorsTable': JSON.stringify(tableRows),
      };
    }

    case 'report_stock_on_hand': {
      const report = seedStockReport;
      // columns: category, itemCode, description, qty, value, reorderFlag
      const tableRows = report.items.map(i => [
        i.category,
        i.itemCode,
        i.description,
        `${i.qtyOnHand} (${i.qtyAvailable} avail)`,
        formatZAR(i.totalValue),
        i.qtyAvailable <= 0 ? 'REORDER' : '',
      ]);
      return {
        'reportTitle': report.title,
        'reportDate': report.reportDate,
        'totalValue': formatZAR(report.grandTotalValue),
        'stockTable': JSON.stringify(tableRows),
      };
    }

    case 'report_sales_summary': {
      const report = seedSalesReport;
      // columns: customer, product, qty, revenue, cost, margin
      const tableRows = report.reps.flatMap(rep =>
        rep.months.map(m => [
          rep.name,
          m.month,
          String(m.qty),
          formatZAR(m.revenue),
          formatZAR(m.revenue * (1 - m.marginPct / 100)),
          `${m.marginPct.toFixed(1)}%`,
        ])
      );
      return {
        'reportTitle': report.title,
        'dateRange': report.dateRange,
        'totalRevenue': formatZAR(report.ytdTotalRevenue),
        'salesTable': JSON.stringify(tableRows),
      };
    }

    case 'label': {
      // Default to shipping label data
      const sl = seedShippingLabel;
      return {
        'recipientName': sl.recipientName,
        'recipientAddress': sl.recipientAddress,
        'senderAddress': sl.senderAddress,
        'trackingBarcode': sl.trackingNumber,
        'trackingNumber': sl.trackingNumber,
        'trackingQr': sl.trackingNumber,
        'shipDate': sl.shipDate,
        'serviceType': sl.serviceType,
        // Product label fields
        'productName': seedProductLabel.productName,
        'description': seedProductLabel.description,
        'price': seedProductLabel.price,
        'skuBarcode': seedProductLabel.barcode,
        'skuText': seedProductLabel.itemCode,
        // Asset tag fields
        'assetIdBarcode': seedAssetTag.assetId,
        'assetQr': seedAssetTag.assetId,
        'assetName': seedAssetTag.assetName,
        'assetId': seedAssetTag.assetId,
        'department': seedAssetTag.department,
        'tagDate': seedAssetTag.tagDate,
        // Shelf label fields
        'sku': seedShelfLabel.sku,
        'barcode': seedShelfLabel.barcode,
      };
    }

    default:
      return {};
  }
}

/**
 * Get all seed datasets as a summary object for the admin seed endpoint.
 */
export function getSeedSummary() {
  return {
    organisations: seedOrganisations.length,
    customers: seedCustomers.length,
    invoices: seedInvoices.length,
    statements: seedStatements.length,
    purchaseOrders: seedPurchaseOrders.length,
    deliveryNotes: seedDeliveryNotes.length,
    creditNotes: seedCreditNotes.length,
    reports: {
      agedDebtors: 1,
      stockOnHand: 1,
      salesSummary: 1,
    },
    labels: {
      shipping: 1,
      product: 1,
      assetTag: 1,
      shelf: 1,
    },
  };
}
