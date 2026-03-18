# FUNCTIONAL SPECIFICATION

## pdfme ERP Edition

**Custom Document Designer & Report Generation Engine**

| | |
|---|---|
| **Version** | 1.2 |
| **Date** | 18 March 2026 |
| **Status** | For AI Agent Implementation |
| **Stack** | NestJS · Next.js · TypeScript |
| **Base Library** | pdfme (MIT) |

### Changelog

| Version | Date | Summary |
|---------|------|---------|
| 1.0 | 18 March 2026 | Initial draft — core designer, plugins, render pipeline, phases 1–12 |
| 1.1 | 18 March 2026 | Gap analysis additions — Sections 18–31, Phase 13–17 appended. Localisation, conditional visibility, grouped reports, render resilience, template validation, font management, preview PDF, audit trail, bulk progress, template locking, import/export, PDF merge, accessibility, rate limiting, dynamic content height, rich text, multi-currency, tenant backup |
| 1.2 | 18 March 2026 | Replaced all S3/cloud storage references with abstract `FileStorageService` backed by local or network-attached disk. Removed MinIO/AWS dependency. Added comprehensive API contract (Section 34) with full request/response schemas, HTTP status codes, authentication headers, pagination, and error envelope for all endpoints — designed for seamless drop-in integration with the host ERP application. |

---

## 1. Overview & Purpose

This document is the authoritative functional specification for the pdfme ERP Edition — a forked, extended build of the open-source pdfme library tailored for use as the document design and report generation engine within a NestJS/Next.js ERP platform.

It is written to be consumed directly by an AI coding agent (Claude Code or equivalent) and should provide sufficient context to implement the described system without requiring further architectural clarification. All decisions documented here are final unless explicitly marked as TBD.

> Base repository: https://github.com/pdfme/pdfme | Licence: MIT | Fork strategy: maintain upstream compatibility in core packages; extend via custom packages and plugins only

### 1.1 Goals

- Provide a WYSIWYG document designer embeddable in Next.js with a professional, ERP-grade UI
- Enable end-customers (tenants) to design their own document templates (invoices, statements, purchase orders, delivery notes, credit notes)
- Provide a report template designer for operational reports (aged debtors, stock on hand, sales analysis, etc.)
- Expose a curated, schema-driven field picker so designers can bind ERP data fields without knowing field names
- Generate PDFs natively in Node.js via pdfme `generate()` — no WeasyPrint or HTML intermediary
- Support a prebuilt system template library that tenants can fork and customise
- Support multi-tenancy with strict org-level isolation and role-based access control
- Remain fully open-source in the fork — no proprietary lock-in in generated output

### 1.2 Non-Goals

- Email template design (out of scope — separate tooling)
- Real-time collaborative editing (future phase)
- Native mobile designer (responsive viewer only in v1)
- Direct WeasyPrint integration (replaced by pdfme native generation)

### 1.3 Technology Constraints

| Constraint | Detail | Flexibility |
|---|---|---|
| Language | TypeScript throughout — no Python in the document pipeline | Hard requirement |
| Frontend framework | Next.js 14+ (App Router) | Hard requirement |
| Backend framework | NestJS 10+ | Hard requirement |
| PDF engine | pdfme (forked, MIT) | Hard requirement |
| Database | PostgreSQL via Prisma ORM | Hard requirement |
| File storage | Local or network-attached disk via abstract `FileStorageService` (see Section 5.6) | Hard requirement |
| Queue | Bull (Redis-backed) for async PDF generation | Hard requirement |
| Auth | Existing ERP auth — JWT passed to designer via props | Hard requirement |
| Styling | Tailwind CSS + shadcn/ui | Hard requirement |

---

## 2. Fork Strategy & Repository Structure

### 2.1 Fork Approach

Fork pdfme/pdfme on GitHub into the organisation's namespace. The fork must:

- Preserve all upstream packages unchanged wherever possible
- Add new packages in the `packages/` monorepo directory using the `@pdfme-erp/` namespace
- Override only the UI package (`@pdfme/ui`) to deliver the redesigned designer — maintain API compatibility with upstream
- Never modify `@pdfme/generator` or `@pdfme/common` — these are consumed as-is

> Rationale: Keeping generator and common untouched means upstream bug fixes and schema additions can be cherry-picked without conflict. All customisation lives in the UI layer and new packages.

### 2.2 Monorepo Structure

```
pdfme-erp/
├── packages/
│   ├── common/              ← upstream, do not modify
│   ├── generator/           ← upstream, do not modify
│   ├── schemas/             ← upstream base schemas (text, image, barcode)
│   ├── ui/                  ← FORKED — redesigned designer UI
│   └── erp-schemas/         ← NEW — custom ERP schema plugins
│       └── src/
│           ├── line-items-table/    ← dynamic rows with page-break support
│           ├── erp-image/           ← logo/stamp with file storage resolver
│           ├── signature-block/     ← signature placeholder
│           ├── qr-barcode/          ← QR with ERP URL binding
│           └── watermark/           ← draft/copy/void overlay
├── apps/
│   ├── designer-sandbox/    ← Next.js dev harness for the designer
│   └── storybook/           ← component library docs
├── nest-module/             ← NEW — NestJS integration package
│   └── src/
│       ├── template.service.ts
│       ├── render.service.ts
│       ├── datasource.registry.ts
│       └── template.controller.ts
└── package.json             ← pnpm workspaces
```

### 2.3 Package Naming

| Package | Status |
|---|---|
| `@pdfme/common` | Upstream — no changes |
| `@pdfme/generator` | Upstream — no changes |
| `@pdfme/schemas` | Upstream — no changes |
| `@pdfme/ui` | Forked — redesigned UI, same public API |
| `@pdfme-erp/schemas` | New — ERP-specific schema plugins |
| `@pdfme-erp/nest` | New — NestJS service module |

---

## 3. Designer UI Redesign (@pdfme/ui)

### 3.1 Design Philosophy

The upstream pdfme designer is functional but minimal — it exposes a canvas with basic controls and a property panel. For the ERP edition, the designer must feel native to a professional business application. The target aesthetic is comparable to Figma or Notion — clean, sidebar-driven, with clear visual hierarchy and no distracting chrome.

The designer is embedded inside the ERP's Next.js frontend as a full-page component. It receives configuration props and communicates back to the host via callback functions. It must not manage its own auth, routing, or API calls — those are the host application's concern.

### 3.2 Layout Structure

```
┌─────────────────────────────────────────────────────────────────┐
│ TOOLBAR [Template name] [Page size ▾] [Zoom ─────] [Actions]   │
├──────────┬──────────────────────────────────────┬───────────────┤
│ PANEL    │                                      │ PROPERTIES    │
│ LEFT     │         CANVAS (A4/Letter/etc.)      │ PANEL         │
│          │                                      │               │
│ Blocks   │  ┌──────────────────────────────┐    │ (context-     │
│ ──────   │  │                              │    │  sensitive)   │
│ Fields   │  │    Live document preview     │    │               │
│ ──────   │  │                              │    │ Schema type   │
│ Assets   │  │                              │    │ Position/size │
│ ──────   │  └──────────────────────────────┘    │ Typography    │
│ Pages    │                                      │ Data binding  │
│          │    [+ Add page]  Page 1 of 3         │ Constraints   │
└──────────┴──────────────────────────────────────┴───────────────┘
```

### 3.3 Left Panel — Tabs

#### 3.3.1 Blocks Tab

Displays all available schema types as draggable block cards. Blocks are grouped by category:

| Category | Blocks | Availability |
|---|---|---|
| Content | Text, Multi-line text, Rich text | Always available |
| Media | Image, Logo, QR code, Barcode | Always available |
| Data | ERP field, Calculated field | Requires field schema |
| Layout | Line, Rectangle, Spacer, Page number | Always available |
| ERP | Line items table, Totals block, Signature block, Watermark | ERP schemas package |

Drag a block from the panel onto the canvas to add it. Double-click a block on canvas to enter edit mode.

#### 3.3.2 Fields Tab — Data Field Picker

This is the core ERP-specific feature. The Fields tab exposes a searchable, categorised tree of all data fields available for the current template context. Designers drag a field onto the canvas or click a field while a schema element is selected to bind it.

**Field Schema Definition**

The host application provides a `fieldSchema` prop to the Designer component. This is a JSON structure defining all available fields:

```typescript
// FieldSchema type (defined in @pdfme-erp/schemas)
interface FieldGroup {
  key: string;          // e.g. "invoice"
  label: string;        // e.g. "Invoice"
  icon?: string;        // lucide icon name
  fields: FieldDefinition[];
  groups?: FieldGroup[]; // nested groups
}

interface FieldDefinition {
  key: string;          // e.g. "invoice.number"
  label: string;        // e.g. "Invoice Number"
  type: 'string' | 'number' | 'currency' | 'date' | 'boolean' | 'image';
  format?: string;      // e.g. "dd/MM/yyyy", "#,##0.00"
  example: string;      // shown in preview mode
  description?: string;
}
```

**Example Field Schema for Invoice Context**

```typescript
const invoiceFieldSchema: FieldGroup[] = [
  {
    key: 'organisation',
    label: 'Organisation',
    icon: 'building',
    fields: [
      { key: 'org.name', label: 'Company Name', type: 'string', example: 'Acme Trading (Pty) Ltd' },
      { key: 'org.logo', label: 'Company Logo', type: 'image', example: '' },
      { key: 'org.vatNumber', label: 'VAT Number', type: 'string', example: '4530012345' },
      { key: 'org.regNumber', label: 'Reg Number', type: 'string', example: '2020/012345/07' },
      { key: 'org.address', label: 'Address', type: 'string', example: '123 Main Rd, Cape Town' },
      { key: 'org.phone', label: 'Phone', type: 'string', example: '+27 21 555 0100' },
      { key: 'org.email', label: 'Email', type: 'string', example: 'accounts@acme.co.za' },
    ]
  },
  {
    key: 'customer',
    label: 'Customer',
    icon: 'user',
    fields: [
      { key: 'customer.name', label: 'Customer Name', type: 'string', example: 'Widget Corp' },
      { key: 'customer.vatNumber', label: 'VAT Number', type: 'string', example: '4530098765' },
      { key: 'customer.address', label: 'Billing Address', type: 'string', example: '456 Oak Ave, Sandton' },
      { key: 'customer.email', label: 'Email', type: 'string', example: 'ap@widgetcorp.co.za' },
      { key: 'customer.balance', label: 'Account Balance', type: 'currency', format: '#,##0.00', example: 'R 12,450.00' },
    ]
  },
  {
    key: 'invoice',
    label: 'Invoice',
    icon: 'file-text',
    fields: [
      { key: 'invoice.number', label: 'Invoice Number', type: 'string', example: 'INV-2024-00891' },
      { key: 'invoice.date', label: 'Invoice Date', type: 'date', format: 'dd/MM/yyyy', example: '15/03/2025' },
      { key: 'invoice.duedate', label: 'Due Date', type: 'date', format: 'dd/MM/yyyy', example: '14/04/2025' },
      { key: 'invoice.reference', label: 'Reference', type: 'string', example: 'PO-2024-003' },
      { key: 'invoice.subtotal', label: 'Subtotal', type: 'currency', format: '#,##0.00', example: 'R 10,826.09' },
      { key: 'invoice.vatrate', label: 'VAT Rate', type: 'number', format: '0.00%', example: '15%' },
      { key: 'invoice.vat', label: 'VAT Amount', type: 'currency', format: '#,##0.00', example: 'R 1,623.91' },
      { key: 'invoice.total', label: 'Total', type: 'currency', format: '#,##0.00', example: 'R 12,450.00' },
    ]
  },
  {
    key: 'lineitems',
    label: 'Line Items',
    icon: 'list',
    fields: [
      { key: 'lineitems[].sku', label: 'Item SKU', type: 'string', example: 'PRD-001' },
      { key: 'lineitems[].description', label: 'Description', type: 'string', example: 'Widget A — Standard' },
      { key: 'lineitems[].quantity', label: 'Quantity', type: 'number', example: '5' },
      { key: 'lineitems[].uom', label: 'Unit of Measure', type: 'string', example: 'EA' },
      { key: 'lineitems[].unitPrice', label: 'Unit Price', type: 'currency', example: 'R 100.00' },
      { key: 'lineitems[].lineTotal', label: 'Line Total', type: 'currency', example: 'R 500.00' },
      { key: 'lineitems[].serials', label: 'Serial/Lot Numbers', type: 'string', example: 'SN001, SN002',
        description: 'Comma-separated list of serial or lot numbers. Row renders only if non-empty.' },
      { key: 'lineitems[].customerSku', label: 'Customer SKU Ref', type: 'string', example: 'CX-4421-A',
        description: 'Customer part reference. Row renders only if non-empty.' },
      { key: 'lineitems[].notes', label: 'Line Notes', type: 'string', example: 'Handle with care',
        description: 'Free-text note for this line. Row renders only if non-empty.' },
      { key: 'lineitems[].warrantyRef', label: 'Warranty Reference', type: 'string', example: 'WRN-2025-0441',
        description: 'Warranty document reference. Row renders only if non-empty.' },
    ]
  },
];
```

**Field Picker UI Behaviour**

- Fields tree is searchable — typing filters across all groups and sub-groups
- Dragging a field onto the canvas creates a text schema element pre-configured with the field binding
- Clicking a field while a canvas element is selected binds that field to the selected element
- Field type determines which schema types are compatible — image fields may only be bound to image schema elements
- Example values are shown in the canvas in preview/design mode instead of field keys
- Field keys are stored in the schema as the content value prefixed with `{{ }}` — e.g. `{{invoice.number}}`

#### 3.3.3 Assets Tab

- Lists uploaded images, fonts, and brand assets available to the tenant
- Supports drag-to-canvas for images
- Upload directly from this panel (posts to NestJS asset endpoint, stores on disk via `FileStorageService`)
- System fonts and tenant-uploaded fonts both shown

#### 3.3.4 Pages Tab

- Thumbnail strip of all pages in the template
- Drag to reorder pages
- Right-click context menu: duplicate page, delete page, set as cover page

### 3.4 Canvas

- Renders the pdfme template in real time — updates as schema elements are added/moved/configured
- Rulers on top and left edges (px and mm toggleable)
- Snap-to-grid with configurable grid size (default 5mm)
- Snap-to-element alignment guides when dragging near other elements
- Click to select, cmd/ctrl+click to multi-select
- Arrow keys to nudge selected elements by 1px (shift+arrow = 10px)
- Delete/backspace to remove selected element
- Canvas zoom: 25% to 200%, controlled by toolbar slider or Ctrl+scroll
- Page boundary shown with shadow; elements outside boundary highlighted in red

### 3.5 Right Properties Panel

Context-sensitive panel that shows configuration options for the currently selected element. Sections:

| Section | Controls | Applies To |
|---|---|---|
| Position & Size | x, y, width, height (numeric inputs + unit toggle mm/px) | All elements |
| Typography | Font family, size, weight, colour, alignment, line height | Text elements |
| Data Binding | Field picker dropdown, format override, fallback value | All elements |
| Appearance | Background colour, border, opacity, border-radius | Most elements |
| Schema Options | Type-specific options (e.g. barcode type, table columns) | Schema-specific |
| Constraints | Lock position, lock size, hide on empty, required | All elements |
| Visibility | Output channel (Both/Email/Print) + Page scope (All/First/Last/Not first) | All elements |
| Conditional | Condition expression for data-driven show/hide (Section 18) | All elements |

### 3.6 Toolbar

| Control | Behaviour | Position |
|---|---|---|
| Template name | Inline editable — click to rename | Left |
| Page size selector | A4, Letter, A5, Legal, Custom | Left |
| Undo / Redo | Full history stack | Centre |
| Zoom control | Slider + percentage input + fit-to-page button | Centre |
| Preview mode | Toggle — replaces field keys with example values | Right |
| Generate preview PDF | Produces a real PDF with sample data (Section 27) | Right |
| Save draft | Auto-saves every 30s; manual save button | Right |
| Publish | Promotes current draft to published status | Right |
| Export JSON | Downloads raw template schema for debugging | Right |
| Version history | Opens version history panel (clock icon) | Right |

### 3.7 Designer Component API

The Designer is exported as a React component from `@pdfme/ui`. The following props are added in the ERP fork (in addition to all existing upstream props):

```typescript
interface ErpDesignerProps extends DesignerProps {
  // Field schema for the data field picker
  fieldSchema: FieldGroup[];

  // Template context — determines which field schema to load
  templateContext: 'invoice' | 'statement' | 'purchase_order' |
    'delivery_note' | 'credit_note' | 'report' | string;

  // Tenant branding
  brandConfig?: {
    primaryColour: string;
    logoUrl: string;
    fonts: FontConfig[];
  };

  // Tenant locale configuration (Section 19)
  localeConfig?: LocaleConfig;

  // Callbacks
  onSaveDraft: (template: Template) => Promise<void>;
  onPublish: (template: Template) => Promise<void>;
  onAssetUpload: (file: File) => Promise<string>; // returns asset URL
  onGeneratePreview?: (template: Template) => Promise<string>; // returns signed PDF URL (Section 27)

  // Permissions
  permissions: {
    canPublish: boolean;
    canDelete: boolean;
    canExportJson: boolean;
  };
}
```

> Note for agent: `ErpDesignerProps.fieldSchema` must also expose sub-row field groups for the line items table. See Section 17.3 for the expanded field schema structure that includes serial/lot and customer SKU sub-fields.

---

## 4. ERP Schema Plugins (@pdfme-erp/schemas)

### 4.1 Plugin Architecture

pdfme uses a plugin system where each schema type implements a Plugin interface with three functions: `pdf` (renders to PDF via pdf-lib), `ui` (renders in the designer canvas and forms), and `propPanel` (defines the properties panel configuration). All ERP schema plugins follow this contract.

```typescript
// Every plugin in @pdfme-erp/schemas exports this shape
export const myPlugin: Plugin<MySchema> = {
  pdf: async (arg) => { /* pdf-lib rendering */ },
  ui: async (arg) => { /* canvas / form rendering */ },
  propPanel: { /* property panel schema */ },
  icon: '<svg>...</svg>',
};
```

### 4.2 Line Items Table Plugin

The most complex and critical ERP schema plugin. Renders a dynamic table that expands across pages as rows are added. See also Section 17 for multi-row groups, page scoping and max rows — worked examples are there.

#### 4.2.1 Requirements

- Columns fully configurable: key, label, width, alignment, format
- Automatic page break when content overflows — header repeats on continuation pages
- Max rows per page configurable — precise pagination control for page-scoped elements
- Multi-row groups: each logical data record renders as N physical rows of different types
- Sub-rows conditionally rendered based on field presence or expression
- Alternating shading per logical group, not per physical row
- Footer rows (subtotal, VAT, total) at end of table — not bottom of page
- Column widths as percentages summing to 100
- Designer shows static preview with example data

#### 4.2.2 Full Schema Definition — see Section 17 for worked examples

```typescript
interface LineItemsTableSchema extends SchemaForUI {
  type: 'lineItemsTable';
  dataKey: string; // e.g. "lineitems"
  maxRowsPerPage?: number | {
    first: number;
    middle: number;
    last: number;
  };
  columns: ColumnDefinition[];
  rowTemplates: RowTemplate[]; // ordered: primary row first, sub-rows after
  headerStyle: RowStyle;
  footerRows?: FooterRowDefinition[];
  repeatHeaderOnNewPage: boolean;
  alternateGroupShading: boolean; // alternates per logical group not physical row
}

interface ColumnDefinition {
  key: string;
  label: string;
  widthPercent: number; // all columns must sum to 100
  align: 'left' | 'center' | 'right';
  format?: string;
}

interface RowTemplate {
  id: string;
  label: string;
  rowType: 'primary' | 'sub';
  condition?: RowCondition; // sub-rows only — omit for primary
  cells: CellDefinition[];
  style: RowStyle;
}

interface RowCondition {
  type: 'fieldNonEmpty' | 'expression';
  fieldKey?: string;
  expression?: string;
}

interface CellDefinition {
  columnKey: string;
  content: string; // {{field.key}} or literal text
  colSpan?: number;
  style?: Partial<RowStyle>;
}

interface RowStyle {
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontColour: string;
  backgroundColour: string;
  borderColour: string;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
  minHeight: number; // mm
}

interface FooterRowDefinition {
  cells: CellDefinition[];
  style: RowStyle;
  condition?: RowCondition;
}
```

### 4.3 ERP Image Plugin

Extends the base image schema to support storage-resolved assets (logos, stamps) that are stored per-tenant. At generate time, the plugin fetches the asset from `FileStorageService` using the stored file path. In the designer, it shows a placeholder with the asset label.

### 4.4 Signature Block Plugin

- Renders a signature line with configurable label (e.g. "Authorised Signatory")
- Optional "For and on behalf of [company name]" sub-label pulled from field binding
- In the designer: shown as a styled placeholder
- In generated PDF: renders as a horizontal rule with label text

### 4.5 Watermark Plugin

- Renders diagonal text overlay across the page (e.g. DRAFT, COPY, VOID)
- Configurable text, colour, opacity, rotation (default 45°), font size
- Applied per-page or globally via template-level configuration
- Controlled by a template variable — can be suppressed at generate time by passing `watermark: null` in inputs

### 4.6 Calculated Field Plugin

- Displays the result of a simple expression evaluated against the input data
- Expression syntax: simple arithmetic + field references, e.g. `{{invoice.total}} * 0.15`
- Format output using the same format string as other fields
- Evaluated at generate time — not in the designer preview

---

## 5. NestJS Integration Module (@pdfme-erp/nest)

### 5.1 Module Structure

```typescript
@Module({
  imports: [BullModule.registerQueue({ name: 'pdf-generation' })],
  providers: [TemplateService, RenderService, DataSourceRegistry],
  controllers: [TemplateController, RenderController],
  exports: [TemplateService, RenderService, DataSourceRegistry],
})
export class PdfmeErpModule {}
```

### 5.2 TemplateService

Manages CRUD, versioning, and tenant isolation for all template records.

```typescript
interface TemplateService {
  create(orgId: string, dto: CreateTemplateDto): Promise<TemplateRecord>;
  getPublished(orgId: string, type: TemplateType): Promise<TemplateRecord>;
  getVersionHistory(orgId: string, templateId: string): Promise<TemplateVersion[]>;
  saveDraft(orgId: string, templateId: string, schema: Template): Promise<TemplateRecord>;
  publish(orgId: string, templateId: string): Promise<TemplateRecord>;
  fork(orgId: string, systemTemplateId: string): Promise<TemplateRecord>;
  listSystemTemplates(type?: TemplateType): Promise<SystemTemplate[]>;
}
```

### 5.3 Database Schema

```prisma
model Template {
  id            String    @id @default(cuid())
  orgId         String?   // null = system template
  type          String    // invoice | statement | report_aged_debtors | ...
  name          String
  schema        Json      // pdfme Template JSON
  status        String    // draft | published | archived
  version       Int       @default(1)
  saveMode      String?   // 'inPlace' | 'newVersion' — recorded for audit
  publishedVer  Int?      // which version is currently live
  forkedFromId  String?
  forkedFrom    Template? @relation("Fork", fields: [forkedFromId], references: [id])
  forks         Template[] @relation("Fork")
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  createdBy     String    // userId
  lockedBy      String?   // userId holding edit lock (Section 28)
  lockedAt      DateTime? // lock acquisition time (Section 28)

  @@index([orgId, type, status])
}

model GeneratedDocument {
  id            String    @id @default(cuid())
  orgId         String
  templateId    String
  templateVer   Int       // snapshot of version used
  entityType    String    // invoice | statement | ...
  entityId      String    // FK to source record
  filePath      String    // relative path within FileStorageService root
  pdfHash       String    // SHA-256 hash for tamper detection (Section 22)
  status        String    // queued | generating | done | failed
  outputChannel String    // 'email' | 'print'
  triggeredBy   String    // userId who initiated the render (Section 22)
  inputSnapshot Json?     // optional: serialised inputs used for audit (Section 22)
  createdAt     DateTime  @default(now())
}
```

### 5.4 RenderService

```typescript
interface RenderService {
  renderNow(orgId: string, templateType: string, entityId: string, opts?: RenderOptions): Promise<Buffer>;
  queueRender(orgId: string, templateType: string, entityId: string, opts?: RenderOptions): Promise<string>;
  queueBulk(orgId: string, templateType: string, entityIds: string[], opts?: BulkRenderOptions): Promise<string>; // returns batch ID (Section 25)
  getStatus(jobId: string): Promise<RenderStatus>;
  getBatchStatus(batchId: string): Promise<BatchRenderStatus>; // Section 25
}

interface RenderOptions {
  channel: 'email' | 'print';
  locale?: string; // Section 19
}

interface BulkRenderOptions extends RenderOptions {
  onFailure: 'continue' | 'abort'; // Section 25
  notifyUrl?: string;              // webhook callback URL (Section 25)
}
```

Internally, `renderNow()`:

1. Fetches the published template for the org and template type
2. Calls `DataSourceRegistry.resolve(templateType, entityId, orgId)` to get pdfme `inputs[]`
3. Runs template validation (Section 23) — reject if critical errors found
4. Resolves page scopes via `resolvePageScopes()`
5. Resolves output channel via `resolveSchema()`
6. Resolves conditional visibility via `resolveConditions()` (Section 18)
7. Calls `generate({ template, inputs, plugins })` from `@pdfme/generator`
8. Post-processes for PDF/A-3b compliance (Ghostscript)
9. Validates with veraPDF
10. Computes SHA-256 hash of the PDF buffer
11. Uploads PDF buffer to `FileStorageService` under path: `{orgId}/{templateType}/{entityId}/{timestamp}.pdf`
12. Creates a `GeneratedDocument` record with filePath, templateVer snapshot, hash, and triggeredBy
13. Returns the document ID (the host ERP uses the file download endpoint to serve the PDF)

### 5.5 DataSource Registry

Each document/report type registers a DataSource implementation. The registry resolves the correct one at render time.

```typescript
interface DataSource {
  readonly templateType: string;
  resolve(entityId: string, orgId: string, params?: Record<string, unknown>): Promise<PdfmeInputs[]>;
}

@Injectable()
export class InvoiceDataSource implements DataSource {
  readonly templateType = 'invoice';

  async resolve(invoiceId: string, orgId: string): Promise<PdfmeInputs[]> {
    const invoice = await this.invoiceRepo.findWithLines(invoiceId, orgId);
    return [{
      'org.name': invoice.org.name,
      'org.logo': invoice.org.logoUrl,
      'customer.name': invoice.customer.name,
      'invoice.number': invoice.number,
      'invoice.date': format(invoice.date, 'dd/MM/yyyy'),
      'invoice.total': formatCurrency(invoice.total),
      'lineitems': invoice.lines.map(l => ({
        'lineitems[].code': l.productCode,
        'lineitems[].desc': l.description,
        'lineitems[].qty': l.quantity.toString(),
        'lineitems[].price': formatCurrency(l.unitPrice),
        'lineitems[].linetotal': formatCurrency(l.lineTotal),
      })),
    }];
  }
}
```

### 5.6 FileStorageService — Storage Abstraction

All file I/O (generated PDFs, uploaded assets, fonts, signatures, backups) passes through a single `FileStorageService` abstraction. This decouples the application from any specific storage backend and keeps the system suitable for on-premises and VM-based deployments.

#### 5.6.1 Interface

```typescript
interface FileStorageService {
  /** Write a file. Returns the relative path under the storage root. */
  write(relativePath: string, data: Buffer, opts?: WriteOptions): Promise<string>;

  /** Read a file by relative path. Returns the raw buffer. */
  read(relativePath: string): Promise<Buffer>;

  /** Check whether a file exists. */
  exists(relativePath: string): Promise<boolean>;

  /** Delete a file. Returns true if the file existed and was deleted. */
  delete(relativePath: string): Promise<boolean>;

  /** List files under a prefix (non-recursive). */
  list(prefix: string): Promise<string[]>;

  /** Get file metadata without reading the full content. */
  stat(relativePath: string): Promise<FileStat>;

  /** Get the total bytes used under a prefix (for quota enforcement). */
  usage(prefix: string): Promise<number>;
}

interface WriteOptions {
  contentType?: string;       // e.g. 'application/pdf', 'image/png'
  overwrite?: boolean;        // default: false — reject if file exists
}

interface FileStat {
  relativePath: string;
  sizeBytes: number;
  contentType?: string;
  createdAt: Date;
  modifiedAt: Date;
}
```

#### 5.6.2 Default Implementation — Local Disk Adapter

The default adapter writes to a configurable root directory on the local filesystem or network-attached storage (NAS/SAN). Configuration:

```typescript
interface LocalDiskStorageConfig {
  rootDir: string;            // e.g. '/var/lib/pdfme-erp/storage'
  tempDir: string;            // e.g. '/var/lib/pdfme-erp/tmp' — for preview PDFs, backups
  tempRetentionMinutes: number; // default: 60 — auto-purge temp files older than this
}
```

#### 5.6.3 Directory Structure

```
{rootDir}/
├── {orgId}/
│   ├── documents/            ← generated PDFs
│   │   └── {templateType}/{entityId}/{timestamp}.pdf
│   ├── assets/               ← uploaded images, brand assets
│   │   └── {assetId}.{ext}
│   ├── fonts/                ← tenant-uploaded fonts
│   │   └── {fontFamily}/{fontFile}
│   └── signatures/           ← drawn signature PNGs (restricted permissions)
│       └── {userId}.png
├── system/
│   └── fonts/                ← bundled open-licence fonts
└── {tempDir}/
    ├── previews/             ← temporary preview PDFs (auto-purged)
    └── backups/              ← temporary backup ZIPs (auto-purged)
```

#### 5.6.4 Security

- The `signatures/` directory must have filesystem permissions `0700` (owner-only read/write/execute) with the application process as owner
- All file access is mediated through authenticated API endpoints — no directory is served directly by a web server
- Org-level isolation is enforced at the service level: every method validates that the `relativePath` starts with the requesting org's `orgId` prefix (or `system/` for system resources)

#### 5.6.5 Serving Files to Clients

Files are served to the frontend via authenticated API endpoints (see Section 34). The endpoints stream file content directly from disk with appropriate `Content-Type` and `Content-Disposition` headers. There are no pre-signed URLs or time-limited tokens — standard JWT authentication governs access.

#### 5.6.6 Future Extensibility

The `FileStorageService` interface is deliberately simple. If a future deployment requires cloud object storage, a new adapter (e.g., `S3StorageAdapter`, `AzureBlobStorageAdapter`) can be implemented without changing any consuming code. The adapter is selected via environment configuration.

---

## 6. Prebuilt System Template Library

### 6.1 Template Catalogue

The following system templates must be seeded into the database on first deploy. Each is a complete pdfme Template JSON stored in `/nest-module/src/seeds/templates/`.

| Template ID | Description | Context |
|---|---|---|
| invoice-standard | Standard tax invoice — header, line items, VAT summary, totals | invoice |
| invoice-simple | Minimal invoice — no logo column, basic layout | invoice |
| statement-account | Customer account statement — balance b/f, transactions, balance c/f | statement |
| purchase-order-standard | Purchase order with delivery address and terms block | purchase_order |
| delivery-note | Delivery note — no prices, quantity and description only | delivery_note |
| credit-note-standard | Credit note referencing original invoice number | credit_note |
| report-aged-debtors | Aged debtors analysis — 30/60/90/120+ day columns | report |
| report-stock-on-hand | Stock on hand by category — quantity, value, reorder flag | report |
| report-sales-summary | Sales by customer/product for a date range | report |

### 6.2 Seeding Strategy

- System templates have `orgId: null` in the database
- Seeded via a NestJS CLI command: `nest template:seed`
- Templates are stored as `.json` files in source control — the seed command reads and upserts them
- System templates are read-only via API — the fork endpoint creates a tenant copy
- Versioning applies to system templates — bumping the JSON file version triggers a migration prompt for tenants who forked it

---

## 7. Multi-Tenancy & Access Control

### 7.1 Tenant Isolation

- Every API endpoint validates the `orgId` from the JWT against the requested resource
- Template queries always include `WHERE orgId = :orgId OR orgId IS NULL` (system templates)
- File storage paths are prefixed with orgId — tenants cannot access each other's assets
- The Designer component receives `orgId` as a prop from the host — it never derives orgId from the URL

### 7.2 Roles & Permissions

| Permission | Description | Default Grant |
|---|---|---|
| template:view | View published templates and designer (read-only) | All authenticated users |
| template:edit | Open designer, save drafts | Template Designer role |
| template:publish | Promote draft to published | Template Admin role |
| template:delete | Archive a template | Template Admin role |
| template:fork | Fork a system template | Template Designer role |
| template:import | Import template JSON from external source (Section 26) | Template Admin role |
| render:trigger | Trigger on-demand PDF generation | All authenticated users |
| render:bulk | Trigger bulk/scheduled PDF runs | Report Operator role |
| system:seed | Upsert system templates | Super Admin only |

---

## 8. API Contract (REST) — Summary

> **Full API specification with request/response schemas, status codes, and integration examples is in Section 34.** This section provides a quick-reference endpoint listing. All endpoints are mounted under a configurable prefix (default: `/api/pdfme`).

### 8.1 Template Endpoints

```
GET    /api/pdfme/templates                   → list org + system templates (paginated)
POST   /api/pdfme/templates                   → create template (draft)
GET    /api/pdfme/templates/:id               → get template by ID (includes full schema JSON)
PUT    /api/pdfme/templates/:id/draft         → save draft schema
POST   /api/pdfme/templates/:id/publish       → publish draft (runs validation gate)
POST   /api/pdfme/templates/:id/fork          → fork into current org
GET    /api/pdfme/templates/:id/versions      → version history
POST   /api/pdfme/templates/:id/restore       → restore a historical version as new draft
DELETE /api/pdfme/templates/:id               → archive (soft delete)
GET    /api/pdfme/templates/system            → list system templates
GET    /api/pdfme/templates/system/:id        → get system template JSON
POST   /api/pdfme/templates/import            → import TemplateExportPackage JSON (Section 26)
POST   /api/pdfme/templates/:id/validate      → run validation suite without publishing
POST   /api/pdfme/templates/:id/preview       → generate preview PDF with sample data
POST   /api/pdfme/templates/:id/lock          → acquire/renew edit lock (heartbeat)
DELETE /api/pdfme/templates/:id/lock          → release edit lock
```

### 8.2 Render Endpoints

```
POST   /api/pdfme/render/now                  → synchronous render — returns when PDF is ready
POST   /api/pdfme/render/queue                → async render — returns job ID immediately
POST   /api/pdfme/render/bulk                 → batch render — returns batch ID
GET    /api/pdfme/render/status/:jobId        → poll single job status
GET    /api/pdfme/render/batch/:batchId       → get batch aggregate status
GET    /api/pdfme/render/batch/:batchId/progress → SSE stream for real-time batch progress
POST   /api/pdfme/render/batch/:batchId/merge → merge batch PDFs into single file
GET    /api/pdfme/render/download/:documentId → stream PDF binary (authenticated)
GET    /api/pdfme/render/verify/:documentId   → verify PDF integrity (SHA-256 hash check)
GET    /api/pdfme/render/history              → query generated document history (paginated)
```

### 8.3 Asset Endpoints

```
POST   /api/pdfme/assets/upload               → upload image, font, or brand asset
GET    /api/pdfme/assets                      → list org assets (paginated)
GET    /api/pdfme/assets/:assetId             → download/stream asset file
DELETE /api/pdfme/assets/:assetId             → delete asset (with reference warning)
```

### 8.4 Signature Endpoints

```
POST   /api/pdfme/signatures                  → upload drawn signature
GET    /api/pdfme/signatures/me               → get current user's active signature
GET    /api/pdfme/signatures/:id/preview      → stream signature image
DELETE /api/pdfme/signatures/me               → revoke current user's signature
```

### 8.5 Backup Endpoints

```
POST   /api/pdfme/backup/export               → generate backup ZIP
POST   /api/pdfme/backup/import               → import backup ZIP
```

### 8.6 Configuration & Health Endpoints

```
GET    /api/pdfme/health                      → health check (unauthenticated)
GET    /api/pdfme/config                      → get frontend configuration (fonts, locale, features)
GET    /api/pdfme/field-schema/:templateType   → get field schema for designer Fields tab
```

### 8.7 Audit Endpoints

```
GET    /api/pdfme/audit                       → query audit log (paginated)
```

---

## 9. Implementation Order for AI Agent

The following phased order is recommended to maximise testability at each stage. Each phase should be completable independently and result in a runnable, testable state.

### Phase 1 — Foundation (Week 1)

1. Fork pdfme/pdfme repository, configure pnpm workspaces
2. Create `@pdfme-erp/nest` package skeleton with NestJS module boilerplate
3. Implement Prisma schema for Template and GeneratedDocument models
4. Implement TemplateService (CRUD only — no versioning yet)
5. Implement TemplateController with basic REST endpoints
6. Seed script for system templates (empty JSON stubs to start)
7. Unit tests for TemplateService
8. Add `pageScope` field to `SchemaForUI` type in `@pdfme/ui` fork — values: `all` / `first` / `last` / `notFirst`
9. Implement `resolvePageScopes()` in `@pdfme-erp/nest/page-scope-resolver.ts`
10. Implement `estimatePageCount()` — dry-run using maxRowsPerPage when set, overflow detection when not
11. Integrate `resolvePageScopes()` into `RenderService.renderNow()` before `generate()` call
12. Implement Page visibility section in Properties panel (segmented control)
13. Implement page simulator in designer toolbar (1/2/3 page toggle)
14. Implement scope badge overlay on canvas elements (50% opacity + label for out-of-scope elements)

### Phase 2 — Render Pipeline (Week 2)

15. Implement DataSourceRegistry and DataSource interface
16. Implement InvoiceDataSource as the reference implementation
17. Implement RenderService (synchronous renderNow only)
18. Implement `FileStorageService` abstraction and local-disk adapter; wire file upload and download endpoints
19. Implement `/api/render/now` endpoint end-to-end
20. Integration test: create template JSON manually, trigger render, verify PDF output

### Phase 3 — Line Items Table Plugin (Week 3)

21. Implement `@pdfme-erp/schemas` package skeleton
22. Implement `ColumnDefinition`, `RowTemplate`, `RowCondition`, `CellDefinition`, `RowStyle` type definitions
23. Implement lineItemsTable pdf renderer — primary rows with colSpan support
24. Implement sub-row rendering with `RowCondition` evaluation (`fieldNonEmpty` and `expression` types)
25. Implement `maxRowsPerPage` chunking via `chunkRowsIntoPages()` — support number and object form
26. Implement `alternateGroupShading` — shading per logical group not physical row
27. Implement page-break with header repeat on continuation pages
28. Implement lineItemsTable ui renderer — static preview with primary + sub-row example data
29. Implement Row Templates section in Properties panel — add/edit/reorder/delete sub-rows
30. Implement colSpan visual selector in sub-row cell editor
31. Test: invoice with 3 row templates, 20 line items, 5 with serials, 3 with customer SKU — verify pagination and sub-row rendering
32. Test: statement with opening balance, 30 transactions (8 with allocations), closing balance — verify running balance column and last-page ageing summary

### Phase 4 — Designer UI Redesign (Weeks 4–5)

33. Fork `@pdfme/ui` — preserve all upstream logic, replace layout/styling only
34. Implement new three-panel layout (left panel, canvas, right panel)
35. Implement Blocks tab with draggable block cards
36. Implement redesigned Properties panel with all section types
37. Implement Toolbar with undo/redo, zoom, preview mode, save/publish
38. Implement Pages tab with thumbnail strip

### Phase 5 — Field Picker (Week 6)

39. Define FieldGroup and FieldDefinition TypeScript types in `@pdfme-erp/schemas`
40. Implement Fields tab UI — searchable tree with drag-to-canvas
41. Implement field binding in schema elements — store `{{field.key}}` in content
42. Implement example value substitution in preview mode
43. Implement data binding section in Properties panel
44. Pass `fieldSchema` prop through to Designer component

### Phase 6 — Remaining Plugins & Templates (Week 7)

45. Implement erpImage, signatureBlock, watermark, calculatedField plugins
46. Build all 9 system templates as complete pdfme Template JSON files
47. Seed system templates and verify render pipeline for each
48. Implement template versioning and fork workflow

### Phase 7 — Queue, Polish & Tests (Week 8)

49. Implement Bull queue for async rendering (queueRender, queueBulk)
50. Implement render status polling endpoint
51. Assets upload and management endpoints
52. RBAC enforcement on all endpoints
53. E2E test suite covering: design → save → publish → render → verify PDF
54. Performance test: bulk render 100 invoices, verify queue behaviour

### Phase 8 — Expression Engine (Week 9)

55. Implement `expression-engine.ts` in `@pdfme-erp/schemas` with expr-eval base
56. Implement all string functions: LEFT, RIGHT, MID, UPPER, LOWER, TRIM, CONCAT, LEN
57. Implement all conditional functions: IF (nested support), AND, OR, NOT
58. Implement all date functions: FORMAT, DATEDIFF, TODAY, YEAR, MONTH, DAY
59. Implement numeric functions: FORMAT (currency/percent), ROUND, ABS
60. Implement expression editor UI in Properties panel with field picker and test button
61. Unit tests: 100% branch coverage on all functions, null/empty input handling, nested IF

### Phase 9 — Signature Capture (Week 10)

62. Implement SignatureManager component using `signature_pad` library
63. Implement UserSignature model in Prisma and migration
64. Implement signature upload endpoint (`POST /api/signatures`) — private storage directory
65. Implement drawnSignature schema plugin — pdf renderer fetches from `FileStorageService` at render time
66. Implement designer canvas preview for drawnSignature (placeholder with label)
67. Implement signature revocation endpoint and UI
68. Security review: confirm file permissions, signature files not publicly accessible via web server

### Phase 10 — PDF/A Compliance (Week 11)

69. Add Ghostscript to Docker container — verify version supports PDF/A-3b output
70. Implement `pdfa-processor.ts` in `@pdfme-erp/nest` — wraps Ghostscript conversion
71. Implement veraPDF validation step — parse report, surface errors
72. Implement XMP metadata injection in RenderService
73. Implement font fsType validation in asset upload endpoint
74. Update all system templates to use only open-licence fonts
75. Integration tests: generate each system template, validate with veraPDF, assert conformance

### Phase 11 — Output Channel Awareness (Week 12)

76. Add `outputChannel` field to SchemaForUI type in `@pdfme/ui` fork
77. Implement Visibility section in Properties panel (segmented control)
78. Implement channel badges on canvas elements (email-only / print-only indicators)
79. Implement channel preview toggle in toolbar
80. Implement `resolveSchema()` filtering function in RenderService
81. Add `outputChannel` param to all render endpoints
82. Implement output channel prompt modal in designer sandbox app
83. Update GeneratedDocument model with `outputChannel` field
84. Re-author all 9 system templates with correct outputChannel tags
85. Update bulk render endpoint to require explicit channel parameter

### Phase 12 — Version Management Polish (Week 12, parallel)

86. Implement save mode prompt modal in designer
87. Implement version history panel UI in designer toolbar
88. Implement "Restore" action — creates new draft from historical version
89. Add `saveMode` field to Template model and record on every save
90. Cap version history at 50 entries per template — archive older entries

### Phase 13 — Localisation, Multi-Currency & Conditional Visibility (Week 13) — NEW in v1.1

91. Implement `LocaleConfig` type and tenant locale settings (Section 19)
92. Implement locale-aware FORMAT function variants in expression engine (Section 19)
93. Implement multi-currency field type with symbol resolution (Section 20)
94. Implement `condition` property on base `SchemaForUI` type (Section 18)
95. Implement `resolveConditions()` in RenderService pipeline (Section 18)
96. Implement conditional visibility UI in Properties panel — expression editor with field picker (Section 18)
97. Implement condition badge overlay on canvas elements (Section 18)
98. Unit tests: locale formatting for ZAR, USD, EUR, GBP; condition expression evaluation

### Phase 14 — Grouped Report Layouts (Week 14) — NEW in v1.1

99. Implement `GroupedTableSchema` plugin type with `groupBy` support (Section 21)
100. Implement group header/footer row rendering with subtotals (Section 21)
101. Implement multi-level grouping (up to 3 levels) (Section 21)
102. Update report system templates (aged-debtors, sales-summary) with grouping configuration
103. Test: aged debtors grouped by salesperson with subtotals per group
104. Test: sales summary grouped by region → product category with multi-level totals

### Phase 15 — Render Resilience, Validation & Audit (Weeks 15–16) — NEW in v1.1

105. Implement render error handling strategy — field fallback, retry logic, dead-letter queue (Section 22)
106. Implement SHA-256 hashing and audit fields on GeneratedDocument (Section 22)
107. Implement append-only `AuditLog` table for template changes (Section 22)
108. Implement template validation at publish time — binding checks, expression parsing, schema consistency (Section 23)
109. Implement validation warnings in designer on save
110. Implement font management — file storage serving, caching, fallback behaviour (Section 24)
111. Implement bulk render progress — SSE endpoint, batch status aggregation, webhook callback (Section 25)
112. Implement PDF merge endpoint for batch downloads (Section 26)
113. Implement per-tenant rate limiting on render endpoints (Section 29)

### Phase 16 — Template Portability & Locking (Week 17) — NEW in v1.1

114. Implement template import endpoint with validation (Section 26)
115. Implement template export with full dependency packaging (Section 26)
116. Implement pessimistic edit locking with timeout (Section 28)
117. Implement tenant backup export/import (Section 30)
118. Implement preview PDF generation endpoint (Section 27)

### Phase 17 — Dynamic Content, Rich Text & Accessibility (Week 18) — NEW in v1.1

119. Implement text overflow strategy — truncate/shrink-to-fit/clip configuration per element (Section 31)
120. Implement rich text plugin with HTML-subset support (Section 32)
121. Add PDF/UA tagging as optional post-processing step (Section 33)
122. Final integration tests across all new features
123. Performance test: bulk render 500 documents with grouped report templates

---

## 10. Resolved Design Decisions

The following questions were raised during initial spec review and have been answered by the product owner. All are now closed and must be implemented as specified. No further clarification is required.

| ID | Topic | Resolution |
|---|---|---|
| OQ-01 | Report scheduling | RESOLVED: Scheduling is managed entirely by the host ERP — not the designer. The designer has no scheduling UI. The render API accepts a trigger from the ERP scheduler with no knowledge of the schedule itself. |
| OQ-02 | Signature capture | RESOLVED: Drawn signatures are required. See Section 11 for full specification. |
| OQ-03 | PDF/A compliance | RESOLVED: PDF/A-3b compliance is mandatory. All generated documents are legal instruments. See Section 12 for full specification. |
| OQ-04 | Email delivery | RESOLVED: The host ERP manages email delivery entirely. The render pipeline returns a document ID and download URL only. No SMTP, no email SDK in this package. |
| OQ-05 | Calculated/scripted fields | RESOLVED: Full expression engine required — arithmetic, conditional logic (IF/THEN/ELSE), and string functions (LEFT, RIGHT, MID, UPPER, LOWER, TRIM, CONCAT, FORMAT). See Section 13 for full specification. |
| OQ-06 | Template versioning mode | RESOLVED: User-selectable per-save action. When saving changes to a published template, the user is prompted: "Edit in place (overwrite published)" or "Save as new version (keep previous published active until manually promoted)". See Section 14 for full specification. |
| OQ-07 | pdfme Cloud | RESOLVED: pdfme Cloud is excluded entirely. All generation runs in the self-hosted NestJS render service. No calls to external pdfme infrastructure at any point. |
| OQ-08 | Pre-printed stationery | RESOLVED: Output channel awareness is required. Elements can be tagged for email-only or print-only visibility. User is prompted for output channel before generation. See Section 15 for full specification. |

---

## 11. Drawn Signature Plugin

### 11.1 Overview

The signature plugin supports capturing a real drawn signature and embedding it in a generated PDF. This is required for documents that serve as legal instruments. The signature is captured once per signatory, stored securely, and referenced by templates that require it.

### 11.2 Capture Flow

1. A designated signatory opens the Signature Manager in the ERP (not the template designer — this is a separate, standalone UI component exported from `@pdfme-erp/schemas`)
2. The Signature Manager presents a canvas drawing surface (HTML5 Canvas, finger/mouse/stylus input)
3. The signatory draws their signature and clicks Accept
4. The signature is captured as an SVG path, converted to a transparent-background PNG, and stored via `FileStorageService` under path `{orgId}/signatures/{userId}.png`
5. The signature record is stored in the database against the user — see schema below
6. At render time, the signature plugin fetches the PNG from `FileStorageService` and embeds it in the PDF at the configured position and size

> Security requirement: Signature PNGs must be stored in a private directory not directly accessible via the web server. They must only be served through the authenticated API endpoint. The storage directory must have filesystem permissions restricting access to the application process only.

### 11.3 Signature Schema Plugin

```typescript
interface SignatureSchema extends SchemaForUI {
  type: 'drawnSignature';
  signatoryBinding: 'currentUser' | 'fieldKey';
  signatoryFieldKey?: string;
  label: string;
  subLabel?: string;
  showSignatureLine: boolean;
  fallbackBehaviour: 'blank' | 'placeholder' | 'error';
}
```

### 11.4 Database Schema

```prisma
model UserSignature {
  id         String    @id @default(cuid())
  orgId      String
  userId     String
  filePath   String    // relative path to PNG in private storage
  capturedAt DateTime  @default(now())
  revokedAt  DateTime?

  @@unique([orgId, userId])
  @@index([orgId])
}
```

### 11.5 Signature Manager Component API

```typescript
interface SignatureManagerProps {
  orgId: string;
  userId: string;
  existingSignatureUrl?: string;
  onSave: (pngBlob: Blob) => Promise<void>;
  onRevoke?: () => Promise<void>;
}
// Canvas library: signature_pad (MIT) — https://github.com/szimek/signature_pad
```

---

## 12. PDF/A-3b Compliance

### 12.1 Requirement

All documents generated by the render pipeline must conform to the PDF/A-3b standard (ISO 19005-3). PDF/A-3b is the archival PDF standard that permits embedding arbitrary file attachments — making it suitable for e-invoicing schemas (e.g. ZUGFeRD, Factur-X) as a future extension.

### 12.2 What PDF/A-3b Requires

- All fonts must be fully embedded in the PDF — no system font references
- No encryption or password protection
- No JavaScript, audio, video, or 3D content
- Colour spaces must be device-independent (sRGB or CMYK with ICC profile)
- All images must use supported colour spaces
- XMP metadata block must be present and valid
- The document must declare itself PDF/A-3b in its XMP metadata

### 12.3 Implementation Approach

1. Generate PDF buffer via pdfme `generate()` as normal
2. Pass buffer through a PDF/A conversion step using Ghostscript (`-dPDFA=3 -dPDFACompatibilityPolicy=1 -sColorConversionStrategy=sRGB`)
3. Validate the output using veraPDF — reject and surface an error if validation fails
4. Store the veraPDF validation report alongside the PDF in file storage for audit purposes

### 12.4 Font Embedding Requirements

- All fonts used in templates must be embedded at render time
- System fonts (Arial, Times New Roman, etc.) are NOT permitted in PDF/A — only fonts with an open licence that can be bundled
- The system template library must use only open-licence fonts: Inter, Noto Sans, IBM Plex Sans, or Roboto
- Tenant-uploaded fonts must be validated for embeddability (fsType flag = 0 or 4) before acceptance
- The asset upload endpoint must reject fonts with a restrictive fsType flag

### 12.5 XMP Metadata Block

```typescript
{
  "dc:title": "<document type> — <entity reference>",
  "dc:creator": "<org name>",
  "xmp:CreateDate": "<ISO 8601 timestamp>",
  "xmp:ModifyDate": "<ISO 8601 timestamp>",
  "xmp:CreatorTool": "pdfme ERP Edition",
  "pdfaid:part": "3",
  "pdfaid:conformance": "B"
}
```

---

## 13. Expression & Scripted Field Engine

### 13.1 Overview

The Calculated Field plugin (Section 4.6) is extended to support a full expression engine — not just arithmetic. Expressions are defined in the template schema, evaluated at render time against the resolved ERP data inputs, and the result is rendered as a string in the PDF.

### 13.2 Supported Expression Types

**Arithmetic**

```
{{invoice.subtotal}} * 0.15
{{invoice.total}} - {{invoice.deposit}}
({{lineitems[].qty}} * {{lineitems[].unitPrice}}) * (1 - {{invoice.discountRate}})
```

**Conditional (IF/THEN/ELSE)**

```
IF({{invoice.total}} > 10000, "Qualifies for discount", "Standard terms")
IF({{customer.balance}} < 0, "Credit: " & FORMAT(ABS({{customer.balance}}), "R #,##0.00"), "")
IF({{invoice.duedate}} < TODAY(), "OVERDUE", IF({{invoice.duedate}} = TODAY(), "Due today", "Current"))
```

**String Functions**

```
LEFT({{customer.name}}, 30)
RIGHT({{invoice.number}}, 6)
MID({{product.code}}, 3, 4)
UPPER({{customer.name}})
LOWER({{invoice.reference}})
TRIM({{customer.address}})
CONCAT({{org.name}}, " — ", {{invoice.number}})
LEN({{customer.name}})
```

**Date Functions**

```
FORMAT({{invoice.date}}, "dd MMMM yyyy")
FORMAT({{invoice.date}}, "dd/MM/yyyy")
DATEDIFF({{invoice.duedate}}, TODAY())
TODAY()
YEAR({{invoice.date}}), MONTH({{invoice.date}})
```

**Numeric/Currency Formatting**

```
FORMAT({{invoice.total}}, "R #,##0.00")
FORMAT({{invoice.vatrate}}, "0.00%")
ROUND({{invoice.total}}, 2)
ABS({{customer.balance}})
```

### 13.3 Engine Implementation

- Use the `expr-eval` library (MIT licence) as the expression parser base
- Extend with the custom functions listed above
- Implemented in `@pdfme-erp/schemas/expression-engine.ts`
- Expressions evaluated in a strict sandbox — no access to Node.js globals, no `require()`, no `eval()`
- Field references use the same `{{field.key}}` syntax — the engine substitutes values before evaluation
- Type coercion: parse numbers before arithmetic; empty/null values → 0 for arithmetic, `""` for strings
- Evaluation errors surface as a configurable fallback: empty string, `"#ERROR"`, or fail-the-render

### 13.4 Expression Editor in the Designer

- Multi-line code editor (CodeMirror Lite or a simple `<textarea>` with monospace font)
- Field picker button inserts selected field key at cursor position
- "Test expression" button evaluates against example values and shows result inline
- Syntax errors shown inline beneath the editor

---

## 14. Template Version Management

### 14.1 Overview

When a user saves changes to a template that is currently in published status, they must choose how the save is applied. This decision is presented as a modal prompt — it is never inferred automatically.

### 14.2 Save Mode Prompt

| Mode | Behaviour | Effect on DB |
|---|---|---|
| Edit in place | Overwrites the current published template. All future renders immediately use the updated template. Recommended for minor corrections. | Increments `updatedAt`, does not change version integer |
| New version | Saves as a new draft version. The previous published version remains active until promoted. Recommended for layout changes. | Increments version integer, status = draft |

### 14.3 Version History UI

- Accessible from the toolbar via a "Version history" button (clock icon)
- Shows list of all versions: version number, status, saved by, saved at, and a "Restore" action
- "Restore" creates a new draft from a historical version
- Currently published version is always highlighted
- Maximum 50 versions retained per template — older drafts are archived (not deleted)

---

## 15. Output Channel Awareness & Pre-Printed Stationery

### 15.1 Problem Statement

Many ERP customers use pre-printed stationery. When generating a PDF for printing on this stationery, branding elements must be suppressed. When generating for email delivery (blank paper), all elements must be included.

### 15.2 Output Channels

| Channel | Description | Rendering Behaviour |
|---|---|---|
| email | PDF is sent electronically — rendered on blank paper. Default if no channel specified. | Show all elements |
| print | PDF is printed on pre-printed stationery. | Suppress email-only elements |
| both | Element is always visible. Default for all elements. | Always shown |

### 15.3 Element-Level Channel Tagging

```typescript
interface SchemaForUI {
  // ...
  outputChannel: 'both' | 'email' | 'print'; // default: 'both'
}
```

### 15.4 Render Engine Changes

```typescript
async function resolveSchema(template: Template, channel: 'email' | 'print'): Promise<Template> {
  return {
    ...template,
    schemas: template.schemas.map(page =>
      page.filter(element => {
        const ch = element.outputChannel ?? 'both';
        if (ch === 'both') return true;
        return ch === channel;
      })
    )
  };
}
```

### 15.5 System Template Considerations

All 9 system templates must be authored with output channel awareness. Elements pre-tagged as email-only: company logo, company name/address/VAT header block, document border/background, decorative header/footer graphics. All data content elements tagged as "both".

> Design guideline: structure each template with a clearly named "stationery" group of elements and a "content" group. Pre-tag the stationery group as email-only.

---

## 16. Updated Implementation Order

> Phase 1–7 from Section 9 remain valid. Phases 8–12 from v1.0 and Phases 13–17 from v1.1 are appended. See Section 9 for the consolidated list.

---

## 17. Document Form Generation — Advanced Layout

### 17.1 Page-Scoped Elements

#### 17.1.1 Overview

For multi-page documents, certain schema elements should only appear on specific pages. The classic examples: letterhead on first page only, payment terms on last page only, continuation headers on all pages except the first.

#### 17.1.2 pageScope Values

| Value | Behaviour | Typical Use |
|---|---|---|
| all | Element renders on every page. Default. | Running page numbers, watermarks |
| first | First page only. | Company logo, letterhead, customer address |
| last | Last page only. | Payment terms, bank details, totals, signature |
| notFirst | All pages except the first. | Continuation header ("Invoice INV-2024-00891 continued") |

#### 17.1.3 Schema Addition

```typescript
interface SchemaForUI {
  // ...
  pageScope: 'all' | 'first' | 'last' | 'notFirst'; // default: 'all'
  outputChannel: 'both' | 'email' | 'print';        // default: 'both'
  condition?: ElementCondition;                       // NEW in v1.1 (Section 18)
}
```

#### 17.1.4 Render Engine — Page Scope Resolution

```typescript
async function resolvePageScopes(opts: PageScopeOptions): Promise<Template[]> {
  const pageCount = await estimatePageCount(opts);
  return Array.from({ length: pageCount }, (_, i) => {
    const pageIndex = i + 1;
    return {
      ...opts.template,
      schemas: [
        opts.template.schemas[0].filter(el => {
          const scope = el.pageScope ?? 'all';
          if (scope === 'all') return true;
          if (scope === 'first') return pageIndex === 1;
          if (scope === 'last') return pageIndex === pageCount;
          if (scope === 'notFirst') return pageIndex > 1;
          return true;
        })
      ]
    };
  });
}
```

#### 17.1.5 Designer UI — Page Scope Controls

- Properties panel: "Page visibility" segmented control
- Canvas toolbar: page simulator (1/2/3 page toggle)
- Out-of-scope elements shown at 50% opacity with scope badge
- Pages tab thumbnails reflect scope visibility

#### 17.1.6 Interaction with outputChannel

`pageScope` and `outputChannel` are fully orthogonal. The render engine applies both filters independently in sequence. An element tagged as `first + email-only` appears on page 1 of email renders only.

### 17.2 Max Rows Per Page

#### 17.2.1 Why This Exists

Real invoice layouts have first-page-only elements consuming vertical space and last-page-only elements consuming space. Without explicit row limits, the renderer cannot know how many rows fit per page zone.

#### 17.2.2 maxRowsPerPage Schema

```typescript
interface LineItemsTableSchema extends SchemaForUI {
  // ...
  maxRowsPerPage?: number | {
    first: number;   // page 1 (less space — letterhead present)
    middle: number;  // continuation pages (full space)
    last: number;    // last page (less space — totals present)
  };
}
```

#### 17.2.3 Designer UI

- Pagination section: toggle "Auto (overflow-based)" or "Fixed rows per page"
- When Fixed: three numeric inputs (First page, Middle pages, Last page) with "Same for all" checkbox
- Preview simulator uses maxRowsPerPage for page distribution

#### 17.2.4 Render Engine Behaviour

```typescript
function chunkRowsIntoPages(
  rows: ResolvedRowGroup[],
  maxRows: Required<MaxRowsConfig>
): ResolvedRowGroup[][] {
  const pages: ResolvedRowGroup[][] = [];
  let current: ResolvedRowGroup[] = [];
  let physicalRowCount = 0;
  let pageIndex = 0;

  for (const group of rows) {
    const limit = pageIndex === 0 ? maxRows.first : maxRows.middle;
    const groupSize = group.physicalRows.length;
    if (physicalRowCount + groupSize > limit) {
      pages.push(current);
      current = [];
      physicalRowCount = 0;
      pageIndex++;
    }
    current.push(group);
    physicalRowCount += groupSize;
  }
  if (current.length) pages.push(current);
  // Apply last-page limit if final page exceeds last limit
  return pages;
}
```

### 17.3 Multi-Row Groups (Sub-Rows)

#### 17.3.1 Concept

A logical data record may need multiple physical rows. The primary row carries main data; sub-rows carry supplementary data (serial numbers, customer SKU references, etc.) conditionally rendered.

#### 17.3.2 Worked Example — Invoice Line with Serials and Customer SKU

```typescript
rowTemplates: [
  // Row 1: Primary invoice line
  {
    id: 'primary',
    label: 'Invoice line',
    rowType: 'primary',
    style: { fontSize: 10, fontWeight: 'normal', fontColour: '1e2a3a',
      backgroundColour: 'ffffff', borderColour: 'd1d5db',
      paddingTop: 4, paddingBottom: 4, paddingLeft: 6, paddingRight: 6,
      minHeight: 8 },
    cells: [
      { columnKey: 'sku', content: '{{lineitems[].sku}}' },
      { columnKey: 'desc', content: '{{lineitems[].description}}' },
      { columnKey: 'qty', content: '{{lineitems[].quantity}}' },
      { columnKey: 'unit', content: '{{lineitems[].uom}}' },
      { columnKey: 'price', content: '{{lineitems[].unitPrice}}' },
      { columnKey: 'total', content: '{{lineitems[].lineTotal}}' },
    ]
  },
  // Row 2: Serial / Lot numbers
  {
    id: 'serials',
    label: 'Serial / Lot numbers',
    rowType: 'sub',
    condition: { type: 'fieldNonEmpty', fieldKey: 'lineitems[].serials' },
    style: { fontSize: 8, fontWeight: 'normal', fontColour: '6b7280',
      backgroundColour: 'f9fafb', borderColour: 'e5e7eb',
      paddingTop: 2, paddingBottom: 2, paddingLeft: 16, paddingRight: 6,
      minHeight: 6 },
    cells: [
      { columnKey: 'sku', content: '' },
      { columnKey: 'desc', content: 'Serial/Lot: {{lineitems[].serials}}', colSpan: 5 }
    ]
  },
  // Row 3: Customer SKU reference
  {
    id: 'customerSku',
    label: 'Customer SKU reference',
    rowType: 'sub',
    condition: { type: 'fieldNonEmpty', fieldKey: 'lineitems[].customerSku' },
    style: { fontSize: 8, fontWeight: 'normal', fontColour: '6b7280',
      backgroundColour: 'f9fafb', borderColour: 'e5e7eb',
      paddingTop: 2, paddingBottom: 2, paddingLeft: 16, paddingRight: 6,
      minHeight: 6 },
    cells: [
      { columnKey: 'sku', content: '' },
      { columnKey: 'desc', content: 'Cust. ref: {{lineitems[].customerSku}}', colSpan: 5 }
    ]
  }
]
```

#### 17.3.3 Visual Result

Lines with both serial numbers and customer SKU render 3 physical rows; lines with neither render 1. Alternating group shading applies to the entire logical group.

#### 17.3.4 maxRowsPerPage Interaction

`maxRowsPerPage` counts physical rows — not logical groups. The designer Properties panel should show a helper: "Each line item may expand to up to N physical rows based on your sub-row configuration."

#### 17.3.5 Designer UI for Row Templates

- Ordered list of row templates with IDs and row types
- Primary row always first, cannot be deleted or reordered
- "Add sub-row" button opens sub-row editor
- colSpan via visual column span selector
- Sub-rows can be reordered, duplicated, and deleted
- "Preview" button renders a static 3-row example

### 17.4 Statement-Specific Considerations

| Element | Description | Implementation |
|---|---|---|
| Opening balance row | Single row at top showing balance brought forward | First row before data rows |
| Transaction rows | Standard repeating rows | Standard multi-row group with sub-rows for allocation detail |
| Allocation sub-rows | Shows which invoices a payment was allocated against | Sub-row with `fieldNonEmpty` condition on allocations |
| Closing balance row | Balance carried forward | Footer row, not a data row |
| Ageing summary | Last-page-only block showing 30/60/90/120+ breakdown | `pageScope: 'last'`, outside the table |

#### 17.4.1 Running Balance Column

The running balance is pre-computed by the StatementDataSource server-side. The expression engine is NOT used for running balance. The DataSource emits `lineitems[].runningBalance` as a pre-formatted currency string.

#### 17.4.2 Credit/Debit Formatting

```
// Debit column cell expression:
IF({{lineitems[].amount}} > 0, FORMAT({{lineitems[].amount}}, "R #,##0.00"), "")

// Credit column cell expression:
IF({{lineitems[].amount}} < 0, FORMAT(ABS({{lineitems[].amount}}), "R #,##0.00"), "")
```

---

## 18. Conditional Element Visibility (NEW in v1.1)

### 18.1 Overview

Beyond `outputChannel` and `pageScope`, ERP documents frequently require data-driven conditional visibility — showing or hiding any schema element based on the resolved input data. Examples: a "PAST DUE" stamp when an invoice is overdue, a discount line only when a discount exists, a specific legal disclaimer for export customers only.

The `RowCondition` pattern used for line item sub-rows (Section 17.3) is promoted to a base-level property on all schema elements.

### 18.2 Schema Addition

```typescript
interface ElementCondition {
  type: 'fieldNonEmpty' | 'expression';
  fieldKey?: string;          // render if this field is non-empty/non-null
  expression?: string;        // expression engine syntax — render if evaluates to truthy
}

interface SchemaForUI {
  // ... existing properties
  condition?: ElementCondition; // if omitted, element always renders (default)
}
```

### 18.3 Examples

```typescript
// Show "OVERDUE" stamp only when invoice is past due
{
  type: 'text',
  name: 'overdueStamp',
  content: 'OVERDUE',
  condition: {
    type: 'expression',
    expression: '{{invoice.duedate}} < TODAY()'
  }
}

// Show discount line only when discount > 0
{
  type: 'calculatedField',
  name: 'discountLine',
  condition: {
    type: 'expression',
    expression: '{{invoice.discountRate}} > 0'
  }
}

// Show export disclaimer only for international customers
{
  type: 'text',
  name: 'exportDisclaimer',
  condition: {
    type: 'fieldNonEmpty',
    fieldKey: 'customer.exportCountry'
  }
}
```

### 18.4 Render Engine — Condition Resolution

The render engine applies condition filtering after page scope resolution and before output channel filtering:

```typescript
function resolveConditions(template: Template, inputs: PdfmeInputs[]): Template {
  return {
    ...template,
    schemas: template.schemas.map(page =>
      page.filter(element => {
        if (!element.condition) return true;
        return evaluateCondition(element.condition, inputs[0]);
      })
    )
  };
}

function evaluateCondition(condition: ElementCondition, inputs: PdfmeInputs): boolean {
  if (condition.type === 'fieldNonEmpty') {
    const value = inputs[condition.fieldKey!];
    return value !== undefined && value !== null && value !== '';
  }
  if (condition.type === 'expression') {
    return !!expressionEngine.evaluate(condition.expression!, inputs);
  }
  return true;
}
```

### 18.5 Designer UI

- Properties panel: "Conditional visibility" section below the Visibility section
- Toggle: "Always visible" (default) or "Condition"
- When Condition: expression editor identical to CalculatedField, with field picker and "Test" button
- Canvas badge: elements with conditions show a lightning bolt icon badge
- In preview mode with page simulator, conditional elements evaluate against example data and show/hide accordingly

### 18.6 Filter Application Order

The full render pipeline applies filters in this sequence:

1. `resolvePageScopes()` — page-based visibility
2. `resolveConditions()` — data-driven visibility
3. `resolveSchema()` — output channel visibility
4. `generate()` — PDF creation

---

## 19. Localisation & Internationalisation (NEW in v1.1)

### 19.1 Overview

An ERP system serves tenants across different regions with different conventions for currency formatting, date formatting, number formatting, and language. The template engine must support locale-aware rendering without requiring template designers to hardcode regional conventions.

### 19.2 Locale Configuration

```typescript
interface LocaleConfig {
  locale: string;               // BCP-47 tag: 'en-ZA', 'en-US', 'fr-FR', etc.
  currency: {
    code: string;               // ISO 4217: 'ZAR', 'USD', 'EUR'
    symbol: string;             // 'R', '$', '€'
    symbolPosition: 'prefix' | 'suffix';
    decimalSeparator: '.' | ',';
    thousandsSeparator: ',' | '.' | ' ';
    decimalPlaces: number;      // default: 2
  };
  date: {
    shortFormat: string;        // e.g. 'dd/MM/yyyy', 'MM/dd/yyyy'
    longFormat: string;         // e.g. 'dd MMMM yyyy', 'MMMM dd, yyyy'
  };
  number: {
    decimalSeparator: '.' | ',';
    thousandsSeparator: ',' | '.' | ' ';
  };
}
```

### 19.3 Storage

- `LocaleConfig` is stored per-org in the ERP's org settings (not in the template engine database)
- The host application passes `localeConfig` as a prop to the Designer and as a parameter to the render API
- System templates use `{{FORMAT_CURRENCY(value)}}` and `{{FORMAT_DATE(value)}}` — locale-aware functions that read from the config rather than hardcoded format strings

### 19.4 Expression Engine Additions

```
FORMAT_CURRENCY({{invoice.total}})           // uses org's locale config
FORMAT_CURRENCY({{invoice.total}}, "USD")    // override currency code
FORMAT_DATE({{invoice.date}})                // uses org's short date format
FORMAT_DATE({{invoice.date}}, "long")        // uses org's long date format
FORMAT_NUMBER({{lineitems[].quantity}})       // locale-aware number formatting
```

These functions complement the existing `FORMAT()` function — `FORMAT()` remains available for explicit format strings, while the `FORMAT_*` variants use locale configuration.

### 19.5 Designer UI Localisation

- The designer UI itself is authored in English for v1
- Field labels and descriptions come from the `fieldSchema` prop — the host ERP is responsible for translating these if needed
- The Properties panel shows a "Locale preview" indicator showing the current locale's date/currency format

> Future consideration: Full i18n of the designer UI (menus, tooltips, panel labels) is deferred to a future version but should be architecturally accommodated by using a string resource system rather than hardcoded English labels.

---

## 20. Multi-Currency Support (NEW in v1.1)

### 20.1 Overview

In a multi-currency ERP, a single invoice might be denominated in a foreign currency while the tenant's base currency is different. The template engine must support rendering currency values with the correct symbol and formatting for the document's currency, not just the tenant's default.

### 20.2 Document Currency Field

The DataSource must provide a document-level currency indicator:

```typescript
// In inputs[]
{
  'document.currencyCode': 'USD',
  'document.currencySymbol': '$',
  'invoice.total': '12450.00',  // raw numeric string — no symbol
  // ...
}
```

### 20.3 Expression Engine Integration

```
FORMAT_CURRENCY({{invoice.total}})
// If document.currencyCode is present in inputs, uses that currency's formatting
// Otherwise falls back to org locale config
```

### 20.4 Dual-Currency Display

For documents that require both transaction currency and base currency:

```
CONCAT(FORMAT_CURRENCY({{invoice.total}}), " (", FORMAT_CURRENCY({{invoice.totalBase}}, "ZAR"), ")")
// Output: "$12,450.00 (R 224,100.00)"
```

The `FieldDefinition` type gains an optional `currencyField` property to indicate which field determines the currency:

```typescript
interface FieldDefinition {
  // ... existing properties
  currencyField?: string; // e.g. 'document.currencyCode' — tells the renderer which currency to use
}
```

---

## 21. Grouped Report Layouts (NEW in v1.1)

### 21.1 Overview

Operational reports (aged debtors, sales analysis, stock reports) frequently require grouped layouts with group headers, group footers showing subtotals, and multi-level nesting. The `LineItemsTable` plugin handles flat or single-level data; a dedicated `GroupedTable` plugin handles hierarchical report structures.

### 21.2 GroupedTableSchema

```typescript
interface GroupedTableSchema extends SchemaForUI {
  type: 'groupedTable';
  dataKey: string;                  // e.g. "reportRows"
  columns: ColumnDefinition[];      // same type as LineItemsTable
  groupBy: GroupLevel[];            // ordered from outermost to innermost (max 3 levels)
  detailRowTemplate: RowTemplate;   // the leaf-level data row
  headerStyle: RowStyle;
  repeatHeaderOnNewPage: boolean;
  maxRowsPerPage?: number | { first: number; middle: number; last: number };
}

interface GroupLevel {
  fieldKey: string;                 // field to group by, e.g. "salesperson"
  label: string;                   // e.g. "Salesperson"
  headerTemplate: RowTemplate;     // rendered before each group's rows
  footerTemplate?: RowTemplate;    // rendered after each group's rows (subtotals)
  sortOrder: 'asc' | 'desc';
  pageBreakBetweenGroups: boolean; // start each group on a new page
}
```

### 21.3 Render Behaviour

1. The DataSource provides a flat array of rows with group field values populated
2. The `groupedTable` pdf renderer sorts and groups the data according to `groupBy` configuration
3. For each group at each level, the renderer emits: group header row → nested groups or detail rows → group footer row
4. Footer rows can contain expression-based subtotals: `SUM({{reportRows[].amount}})` scoped to the current group
5. Grand total footer rows are supported via the same `footerRows` mechanism as `LineItemsTable`

### 21.4 Worked Example — Aged Debtors by Salesperson

```typescript
{
  type: 'groupedTable',
  dataKey: 'debtorRows',
  columns: [
    { key: 'customer', label: 'Customer', widthPercent: 30, align: 'left' },
    { key: 'current', label: 'Current', widthPercent: 14, align: 'right', format: '#,##0.00' },
    { key: 'days30', label: '30 Days', widthPercent: 14, align: 'right', format: '#,##0.00' },
    { key: 'days60', label: '60 Days', widthPercent: 14, align: 'right', format: '#,##0.00' },
    { key: 'days90', label: '90 Days', widthPercent: 14, align: 'right', format: '#,##0.00' },
    { key: 'days120', label: '120+ Days', widthPercent: 14, align: 'right', format: '#,##0.00' },
  ],
  groupBy: [
    {
      fieldKey: 'salesperson',
      label: 'Salesperson',
      headerTemplate: {
        id: 'spHeader',
        label: 'Salesperson header',
        rowType: 'primary',
        cells: [{ columnKey: 'customer', content: '{{debtorRows[].salesperson}}', colSpan: 6 }],
        style: { fontSize: 11, fontWeight: 'bold', backgroundColour: 'e2e8f0', /* ... */ }
      },
      footerTemplate: {
        id: 'spFooter',
        label: 'Salesperson subtotal',
        rowType: 'primary',
        cells: [
          { columnKey: 'customer', content: 'Subtotal — {{debtorRows[].salesperson}}' },
          { columnKey: 'current', content: 'SUM({{debtorRows[].current}})' },
          { columnKey: 'days30', content: 'SUM({{debtorRows[].days30}})' },
          // ...
        ],
        style: { fontSize: 10, fontWeight: 'bold', backgroundColour: 'f1f5f9', /* ... */ }
      },
      sortOrder: 'asc',
      pageBreakBetweenGroups: false
    }
  ]
}
```

### 21.5 Designer UI

- The grouped table Properties panel extends the line items table panel with a "Grouping" section
- "Add group level" button (max 3 levels)
- Each group level: field picker for group field, header row editor, footer row editor, sort order toggle, page break toggle
- Preview renders example data with 2 groups × 3 rows each to demonstrate grouping visually

---

## 22. Render Resilience, Error Handling & Audit Trail (NEW in v1.1)

### 22.1 Render Error Handling Strategy

| Error Type | Behaviour | Fallback |
|---|---|---|
| Missing field binding | Use element's `fallbackValue` if configured; otherwise render empty string | Configurable per element in Properties panel |
| Missing image asset | Log warning; render placeholder rectangle with "Image not found" text | Do not fail the render |
| Missing signature file | Honour `fallbackBehaviour` on SignatureSchema (`blank` / `placeholder` / `error`) | Configurable per element |
| Expression evaluation error | Use configured error fallback: empty string, `"#ERROR"`, or fail render | Configurable per element |
| DataSource throws | Fail the render; record error in GeneratedDocument with `status: 'failed'` and error message | No partial render — fail cleanly |
| Ghostscript PDF/A conversion failure | Fail the render; store raw PDF with `_non-pdfa` suffix in file storage for debugging | Record veraPDF report |
| Font not found at render time | Fall back to system default open-licence font (Noto Sans); log warning | Never fail on missing font |

### 22.2 Retry Logic

- Transient file storage errors: retry up to 3 times with exponential backoff (1s, 2s, 4s)
- Transient database errors: retry up to 2 times
- Bull queue jobs: configured with `attempts: 3` and `backoff: { type: 'exponential', delay: 5000 }`
- Dead-letter queue: failed jobs after all retries are moved to a `pdf-generation-dlq` queue for manual inspection

### 22.3 Audit Trail

```prisma
model AuditLog {
  id         String   @id @default(cuid())
  orgId      String
  entityType String   // 'template' | 'generatedDocument' | 'signature'
  entityId   String
  action     String   // 'created' | 'updated' | 'published' | 'archived' | 'forked' | 'rendered' | 'deleted'
  userId     String
  metadata   Json?    // action-specific details (e.g., version number, save mode, error message)
  createdAt  DateTime @default(now())

  @@index([orgId, entityType, entityId])
  @@index([orgId, createdAt])
}
```

- Append-only — no UPDATE or DELETE operations on this table
- Written by the TemplateService and RenderService on every state-changing action
- The `inputSnapshot` field on `GeneratedDocument` is optional and configurable per-org (can be large for invoices with many line items) — when enabled, stores the complete `inputs[]` used for rendering so the exact document can be re-created

### 22.4 PDF Tamper Detection

- Every generated PDF has its SHA-256 hash computed before writing to file storage
- Hash is stored on the `GeneratedDocument` record
- A verification endpoint `GET /api/render/verify/:documentId` reads the PDF from file storage, recomputes the hash, and compares — returns `{ verified: true/false }`

---

## 23. Template Validation (NEW in v1.1)

### 23.1 Overview

A validation gate runs at publish time and optionally on save. It catches structural errors before a broken template enters production.

### 23.2 Validation Rules

| Rule | Severity | Description |
|---|---|---|
| Binding check | Error | Every `{{field.key}}` referenced in schema elements must exist in the template's `fieldSchema` |
| Expression parse | Error | All calculated field expressions and condition expressions must parse without syntax errors |
| Column sum check | Error | Line items table column `widthPercent` values must sum to exactly 100 |
| Font availability | Warning | All fonts referenced in the template must be available in the org's font library |
| Required fields present | Warning | System-required fields (e.g., `invoice.number` for invoice templates) should be bound somewhere in the template |
| Page scope sanity | Warning | A template with `pageScope: 'last'` elements but no multi-page content (no line items table) may never trigger last-page rendering |
| Orphaned elements | Info | Elements positioned entirely outside the page boundary |

### 23.3 Validation API

```typescript
interface ValidationResult {
  valid: boolean;          // true if no errors (warnings are permitted)
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  info: ValidationIssue[];
}

interface ValidationIssue {
  rule: string;
  elementName?: string;
  message: string;
  suggestion?: string;     // actionable fix suggestion
}
```

### 23.4 Designer Integration

- On save: validation runs automatically; warnings shown as a toast notification with a "View issues" link
- On publish: validation runs as a gate; if errors exist, publish is blocked and a modal shows the error list
- A "Validate" button in the toolbar runs validation on demand and opens an issues panel

---

## 24. Font Management (NEW in v1.1)

### 24.1 Font Distribution to Designer Client

- Tenant-uploaded fonts are stored via `FileStorageService` under path `{orgId}/fonts/{fontFamily}/{fontFile}`
- The designer client receives a `fonts` array in `brandConfig` containing API URLs to font file endpoints
- Font files are loaded via `fetch()` and converted to `ArrayBuffer` before passing to pdfme
- Fonts are cached in the browser using the Cache API with a 24-hour TTL

### 24.2 Font Loading at Render Time

- The RenderService maintains an in-memory LRU cache of font buffers (max 50MB)
- On cache miss, fonts are fetched from file storage and cached
- System template fonts (Inter, Noto Sans, IBM Plex Sans, Roboto) are bundled in the application under `/app/fonts/` — no remote fetch required

### 24.3 Font Fallback

- If a template references a font that has been deleted from the org's assets, the renderer falls back to Noto Sans
- A warning is logged and included in the `GeneratedDocument` metadata
- The designer shows a visual warning on text elements using a missing font (red border with tooltip)

### 24.4 Font Validation on Upload

- `fsType` flag validation: only flags 0 (installable) and 4 (preview & print) are accepted
- File format validation: only `.ttf`, `.otf`, and `.woff2` accepted
- File size limit: 10MB per font file
- The upload endpoint extracts font metadata (family name, weight, style) and stores it alongside the file path

---

## 25. Bulk Render Progress & Notifications (NEW in v1.1)

### 25.1 Batch Tracking

When `queueBulk` is called, a `RenderBatch` record is created:

```prisma
model RenderBatch {
  id            String    @id @default(cuid())
  orgId         String
  templateType  String
  channel       String    // 'email' | 'print'
  totalJobs     Int
  completedJobs Int       @default(0)
  failedJobs    Int       @default(0)
  failedIds     String[]  // entityIds that failed
  status        String    // 'running' | 'completed' | 'completedWithErrors' | 'aborted'
  onFailure     String    // 'continue' | 'abort'
  notifyUrl     String?   // webhook callback URL
  createdAt     DateTime  @default(now())
  completedAt   DateTime?

  @@index([orgId, status])
}
```

### 25.2 Real-Time Progress

- SSE (Server-Sent Events) endpoint: `GET /api/render/batch/:batchId/progress`
- Emits events: `{ type: 'progress', completed: number, failed: number, total: number }` and `{ type: 'done', status: string }`
- The host ERP UI subscribes to this endpoint to show a progress bar

### 25.3 Webhook Callback

- When `notifyUrl` is provided, the RenderService sends a POST request on batch completion:

```json
{
  "batchId": "clxyz...",
  "status": "completedWithErrors",
  "total": 200,
  "completed": 197,
  "failed": 3,
  "failedIds": ["inv-123", "inv-456", "inv-789"]
}
```

### 25.4 Failure Handling

- `onFailure: 'continue'` — failed jobs are recorded but processing continues; batch completes with `completedWithErrors`
- `onFailure: 'abort'` — on first failure, all remaining queued jobs are cancelled; batch status is `aborted`

---

## 26. Template Import/Export & PDF Merge (NEW in v1.1)

### 26.1 Template Export

The "Export JSON" button in the toolbar exports a self-contained template package:

```typescript
interface TemplateExportPackage {
  version: string;           // export format version
  template: Template;        // pdfme template JSON
  metadata: {
    name: string;
    type: string;
    exportedAt: string;
    exportedBy: string;
    sourceOrgId: string;     // for provenance tracking
  };
  assets: {
    fonts: { family: string; weight: string; style: string; base64: string }[];
    images: { key: string; base64: string; mimeType: string }[];
  };
}
```

### 26.2 Template Import

`POST /api/templates/import` accepts a `TemplateExportPackage` JSON:

1. Validates the template schema structure
2. Runs the full validation suite (Section 23) against the importing org's field schema
3. Imports referenced fonts and images into the org's storage namespace (deduplicating against existing assets)
4. Creates a new draft template in the importing org's namespace
5. Returns the created template record with any validation warnings

### 26.3 PDF Merge for Batch Downloads

`POST /api/render/batch/:batchId/merge` produces a single PDF file containing all successfully generated documents from a batch run:

- Uses pdf-lib `PDFDocument.load()` and `copyPages()` to concatenate PDFs
- Inserts a blank separator page between documents (configurable: on/off)
- Stores the merged PDF in file storage and returns a download URL
- The merged PDF retains PDF/A-3b compliance (re-validated with veraPDF)

---

## 27. Preview PDF Generation (NEW in v1.1)

### 27.1 Overview

The designer canvas preview shows a visual approximation, but it is not a real PDF. Template designers need the ability to generate an actual PDF using sample data to verify page breaks, font rendering, PDF/A compliance, and exact positioning before publishing.

### 27.2 Implementation

- The designer toolbar includes a "Generate preview PDF" button (separate from the canvas preview toggle)
- Clicking it calls `onGeneratePreview(template)` which sends the current draft template to the server
- The server-side endpoint `POST /api/templates/:id/preview`:
  1. Uses the template's example values from `fieldSchema` as inputs
  2. Generates synthetic line item data (configurable: 5, 15, or 30 rows via a dropdown next to the button)
  3. Runs the full render pipeline including PDF/A conversion
  4. Returns a download URL to the preview PDF (temporary — purged after 1 hour)
  5. The preview PDF is NOT stored in the GeneratedDocument table — it is temporary

### 27.3 Preview Watermark

Preview PDFs are automatically watermarked with "PREVIEW — NOT A LEGAL DOCUMENT" in light grey diagonal text across every page to prevent accidental use as a real document.

---

## 28. Template Edit Locking (NEW in v1.1)

### 28.1 Overview

Without collaborative editing, simultaneous edits by two users to the same template risk silent data loss. A pessimistic locking mechanism prevents this.

### 28.2 Lock Behaviour

- When a user opens a template in the designer, the client calls `POST /api/templates/:id/lock`
- If the template is not locked (or the existing lock has expired), a lock is acquired and the user's `userId` and current timestamp are recorded on the Template record
- If the template IS locked by another user, the designer opens in read-only mode with a banner: "This template is being edited by [userName]. You can view it but cannot save changes."
- Locks expire after 30 minutes of inactivity (no save or heartbeat)
- The designer sends a heartbeat `POST /api/templates/:id/lock` every 5 minutes to keep the lock alive
- On save or close, the lock is released via `DELETE /api/templates/:id/lock`

### 28.3 Lock Override

Users with the `template:publish` permission can force-release another user's lock via the UI. This is logged in the audit trail.

---

## 29. Rate Limiting & Abuse Prevention (NEW in v1.1)

### 29.1 Render Rate Limits

| Endpoint | Per-Tenant Limit | Behaviour on Exceed |
|---|---|---|
| `POST /api/render/now` | 60 requests/minute | HTTP 429 with `Retry-After` header |
| `POST /api/render/queue` | 120 requests/minute | HTTP 429 |
| `POST /api/render/bulk` | 5 requests/hour | HTTP 429 |
| Bulk batch size | Max 2,000 entityIds per request | HTTP 400 validation error |

### 29.2 Queue Concurrency

- Bull queue concurrency is configurable per-tenant via org settings
- Default: 5 concurrent render jobs per tenant
- Maximum: 20 concurrent render jobs (configurable by Super Admin)
- The queue processor checks the tenant's current active job count before starting a new job; if at limit, the job remains queued

### 29.3 Storage Quotas

- Per-tenant storage quota: configurable (default 5GB for generated documents, 500MB for assets)
- The render service checks quota before starting a job; if exceeded, fails with a clear error message
- The asset upload endpoint checks quota before accepting uploads

---

## 30. Tenant Backup & Restore (NEW in v1.1)

### 30.1 Export

`POST /api/backup/export` produces a ZIP archive containing:

- All org templates (published + latest draft) as `TemplateExportPackage` JSON files
- All uploaded assets (fonts, images) as binary files with a manifest
- All active user signatures (the ZIP is stored in temporary storage and purged after 1 hour)
- Org locale configuration as JSON

### 30.2 Import

`POST /api/backup/import` accepts a ZIP archive and restores:

- Templates are created as new drafts (never overwrite existing templates)
- Assets are stored via `FileStorageService` with deduplication
- Signatures are only imported if the corresponding user exists in the target org
- Returns a detailed import report: counts of imported/skipped/failed items with reasons

### 30.3 Use Cases

- Migrating templates between staging and production environments
- Onboarding a new tenant with a pre-configured template library
- Disaster recovery

---

## 31. Dynamic Content Height & Text Overflow (NEW in v1.1)

### 31.1 Problem Statement

pdfme uses absolute positioning with fixed `width` and `height` for every schema element. Variable-length text content (customer addresses, product descriptions) may be shorter or longer than the allocated space. The spec must define how text overflow is handled.

### 31.2 Overflow Strategy

Every text-type schema element gains an `overflow` property:

```typescript
interface TextSchemaExtensions {
  overflow: 'clip' | 'truncate' | 'shrinkToFit'; // default: 'clip'
  // clip: text that exceeds the box is hidden (pdfme default behaviour)
  // truncate: text is truncated with "…" appended
  // shrinkToFit: font size is progressively reduced (minimum 6pt) until content fits
}
```

### 31.3 Designer UI

- Properties panel for text elements shows an "Overflow" section with a segmented control: Clip / Truncate / Shrink to fit
- In preview mode, the canvas simulates the chosen overflow behaviour using the example value
- A yellow warning badge appears on text elements when the example value would trigger overflow at the current box size

### 31.4 Architectural Note

Dynamic vertical reflow (elements below a variable-height element shifting downward) is NOT supported in v1. pdfme's absolute-positioning model makes this impractical without a layout engine rewrite. The workaround is to size text boxes generously and use `shrinkToFit`. True dynamic reflow is deferred to a future major version and should be considered when evaluating whether to build a custom layout engine on top of pdfme.

---

## 32. Rich Text Support (NEW in v1.1)

### 32.1 Overview

The Blocks tab lists "Rich text" as a content type. This section specifies what rich text means in the context of pdfme's rendering model.

### 32.2 Supported Formatting

Rich text elements support a limited HTML subset rendered to PDF via pdf-lib:

- **Bold** (`<b>`, `<strong>`)
- **Italic** (`<i>`, `<em>`)
- **Underline** (`<u>`)
- **Font size** (`<span style="font-size: 14px">`)
- **Font colour** (`<span style="color: #ff0000">`)
- **Line breaks** (`<br>`)

Unsupported: bullet lists, tables, images, hyperlinks within rich text. These require the dedicated plugins (line items table, image, etc.).

### 32.3 Authoring

- The rich text block in the designer uses a lightweight WYSIWYG editor (Tiptap or Lexical — no heavy CKEditor dependency)
- The editor toolbar provides bold, italic, underline, font size, and colour controls
- The HTML output is stored in the schema element's `content` field
- Field bindings (`{{field.key}}`) can be embedded within rich text and are substituted at render time before HTML parsing

### 32.4 PDF Rendering

The `richText` plugin's `pdf` function:

1. Parses the HTML subset into styled text runs
2. Renders each run using pdf-lib's text drawing API with the appropriate font, size, weight, and colour
3. Handles line wrapping within the element's fixed bounding box
4. Applies the element's `overflow` strategy (Section 31)

---

## 33. PDF/UA Accessibility (NEW in v1.1)

### 33.1 Overview

PDF/UA (ISO 14289) defines requirements for universally accessible PDF documents. While PDF/A-3b is mandatory for v1, PDF/UA support is implemented as an opt-in feature for tenants that require it (government, public sector, regulated industries).

### 33.2 Implementation

- A per-org setting `enablePdfUA: boolean` (default: `false`)
- When enabled, the post-processing pipeline adds an additional step after Ghostscript PDF/A conversion:
  - Tag the document structure (headings, paragraphs, tables, images)
  - Add alt text to image elements (configurable per image schema element via an `altText` property)
  - Set the document language in the PDF metadata
  - Mark decorative elements as artifacts

### 33.3 Schema Addition

```typescript
interface SchemaForUI {
  // ... existing properties
  altText?: string; // for image elements — used for PDF/UA tagging
}
```

### 33.4 Limitations

Full PDF/UA compliance from a pdf-lib/pdfme pipeline is technically challenging. The v1.1 implementation provides "best effort" tagging that will pass basic accessibility checks. Full WCAG-equivalent compliance may require a dedicated PDF tagging library in a future version.

---

## Appendix A — pdfme Template JSON Structure

For reference, the base pdfme Template type that all ERP templates conform to:

```typescript
// From @pdfme/common
interface Template {
  basePdf: BasePdf;                           // BLANK_PDF or { width, height, padding }
  schemas: Schema[][];                        // one Schema[] per page
  sampledata?: Record<string, string>[];
  columns?: string[];
}

// Each schema element on a page
interface SchemaForUI {
  type: string;                               // 'text' | 'image' | 'lineItemsTable' | ...
  name: string;                               // unique identifier
  position: { x: number; y: number };
  width: number;
  height: number;

  // ERP fork additions
  outputChannel: 'both' | 'email' | 'print'; // Section 15 — default: 'both'
  pageScope: 'all' | 'first' | 'last' | 'notFirst'; // Section 17.1 — default: 'all'
  condition?: ElementCondition;               // Section 18 — default: undefined (always render)
  overflow?: 'clip' | 'truncate' | 'shrinkToFit'; // Section 31 — default: 'clip'
  altText?: string;                           // Section 33 — for PDF/UA accessibility

  // ... type-specific properties
}
```

---

## Appendix B — Glossary

| Term | Definition |
|---|---|
| Template | A pdfme Template JSON object defining the visual layout and schema elements of a document |
| Schema element | A single positioned component on a template page (text box, image, table, etc.) |
| Field binding | The association between a schema element and an ERP data field key (`{{field.key}}` syntax) |
| DataSource | A NestJS service that resolves ERP data into pdfme `inputs[]` for a specific template type |
| System template | A prebuilt template with `orgId: null`, available to all tenants as a fork base |
| Org template | A tenant-owned template, either forked from a system template or created from scratch |
| Generate | The act of combining a template + data inputs to produce a PDF binary via pdfme |
| Publish | Promoting a draft template version to the active/published state used for generation |
| Output channel | The delivery method for a generated PDF — email (blank paper) or print (pre-printed stationery) |
| PDF/A-3b | ISO 19005-3 archival PDF standard — mandatory for all generated documents |
| PDF/UA | ISO 14289 universally accessible PDF standard — optional, per-org setting |
| Expression engine | The sandboxed evaluation layer that processes calculated field expressions at render time |
| Edit in place | Save mode that overwrites the current published template without creating a new version |
| New version | Save mode that creates a new draft, leaving the current published version active until promoted |
| Pre-printed stationery | Physical paper stock with branding elements pre-printed — requires email-only elements to be suppressed |
| Locale config | Per-org configuration defining currency, date, and number formatting conventions |
| Grouped table | A table plugin supporting hierarchical grouping with group headers and subtotal footers |
| Element condition | A data-driven expression that determines whether a schema element renders in the output |
| Template lock | A pessimistic edit lock preventing simultaneous edits to the same template |
| Render batch | A bulk render job tracking multiple documents generated in a single operation |
| FileStorageService | Abstract file I/O interface — default implementation writes to local or network-attached disk; decouples the application from any specific storage backend |

---

## 34. Comprehensive API Contract — Drop-In Integration Reference (NEW in v1.2)

This section defines every HTTP endpoint exposed by the `@pdfme-erp/nest` module. It is designed to be the single reference a host ERP integration developer needs to wire the template engine into a larger application. All endpoints are mounted under a configurable prefix (default: `/api/pdfme`). The host application is responsible for proxying or mounting these routes.

### 34.1 Global Conventions

#### 34.1.1 Authentication

All endpoints require a valid JWT in the `Authorization` header. The JWT is issued by the host ERP's auth system — the pdfme module does not manage authentication itself. It extracts the following claims from the JWT payload:

```typescript
interface JwtClaims {
  sub: string;          // userId
  orgId: string;        // tenant identifier
  roles: string[];      // e.g. ['template:edit', 'template:publish', 'render:trigger']
}
```

The NestJS module exports a configurable `JwtStrategy` that the host application configures with its own secret/public key. If the JWT is missing or invalid, the module returns `401 Unauthorized`.

#### 34.1.2 Tenant Isolation

Every endpoint automatically scopes queries to the authenticated user's `orgId`. No endpoint accepts `orgId` as a URL or body parameter — it is always derived from the JWT. This prevents cross-tenant data access.

#### 34.1.3 Standard Error Envelope

All error responses use a consistent shape:

```typescript
interface ErrorResponse {
  statusCode: number;
  error: string;           // HTTP status text: 'Not Found', 'Forbidden', etc.
  message: string;         // human-readable description
  details?: unknown;       // optional structured details (e.g., validation issues array)
  timestamp: string;       // ISO 8601
  path: string;            // the request path
}
```

#### 34.1.4 Pagination

List endpoints support cursor-based pagination:

```
GET /api/pdfme/templates?limit=20&cursor=clxyz123
```

Response includes:

```typescript
interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    cursor?: string;       // cursor for the next page; omitted on last page
    hasMore: boolean;
  };
}
```

#### 34.1.5 Standard HTTP Status Codes

| Code | Meaning | Used When |
|---|---|---|
| 200 | OK | Successful GET, PUT, DELETE |
| 201 | Created | Successful POST that creates a resource |
| 204 | No Content | Successful DELETE with no body |
| 400 | Bad Request | Validation error, malformed body |
| 401 | Unauthorized | Missing or invalid JWT |
| 403 | Forbidden | Valid JWT but insufficient role/permission |
| 404 | Not Found | Resource does not exist or belongs to another org |
| 409 | Conflict | Template is locked by another user, or version conflict |
| 422 | Unprocessable Entity | Template validation failed at publish time |
| 429 | Too Many Requests | Rate limit exceeded — includes `Retry-After` header |
| 500 | Internal Server Error | Unexpected failure |

---

### 34.2 Template Endpoints

#### `GET /api/pdfme/templates`

List all templates visible to the authenticated org (org templates + system templates).

**Permission:** `template:view`

**Query Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| type | string | No | Filter by template type: `invoice`, `statement`, `purchase_order`, `delivery_note`, `credit_note`, `report`, or any custom type |
| status | string | No | Filter by status: `draft`, `published`, `archived`. Default: returns all statuses |
| includeSystem | boolean | No | Include system templates in results. Default: `true` |
| search | string | No | Full-text search across template name |
| limit | number | No | Page size (1–100). Default: `20` |
| cursor | string | No | Pagination cursor from previous response |

**Response:** `200 OK`

```typescript
{
  data: [
    {
      id: "clxyz123",
      orgId: "org_abc" | null,     // null = system template
      type: "invoice",
      name: "Standard Tax Invoice",
      status: "published",
      version: 3,
      publishedVer: 3,
      forkedFromId: "sys_invoice_std" | null,
      isSystemTemplate: false,
      isLocked: false,
      lockedBy: null,
      createdAt: "2026-01-15T10:30:00Z",
      updatedAt: "2026-03-10T14:22:00Z",
      createdBy: "user_xyz"
    }
  ],
  pagination: { total: 12, limit: 20, hasMore: false }
}
```

---

#### `POST /api/pdfme/templates`

Create a new template (starts as draft).

**Permission:** `template:edit`

**Request Body:**

```typescript
{
  type: "invoice",                   // required
  name: "My Custom Invoice",        // required
  schema: { /* pdfme Template JSON */ }  // optional — empty template if omitted
}
```

**Response:** `201 Created`

```typescript
{
  id: "clxyz456",
  orgId: "org_abc",
  type: "invoice",
  name: "My Custom Invoice",
  status: "draft",
  version: 1,
  publishedVer: null,
  createdAt: "2026-03-18T09:00:00Z",
  updatedAt: "2026-03-18T09:00:00Z",
  createdBy: "user_xyz"
}
```

---

#### `GET /api/pdfme/templates/:id`

Get a single template by ID, including the full schema JSON.

**Permission:** `template:view`

**Response:** `200 OK`

```typescript
{
  id: "clxyz123",
  orgId: "org_abc",
  type: "invoice",
  name: "Standard Tax Invoice",
  status: "published",
  version: 3,
  publishedVer: 3,
  schema: { /* full pdfme Template JSON */ },
  forkedFromId: "sys_invoice_std" | null,
  isLocked: true,
  lockedBy: { userId: "user_abc", lockedAt: "2026-03-18T08:00:00Z" } | null,
  createdAt: "2026-01-15T10:30:00Z",
  updatedAt: "2026-03-10T14:22:00Z",
  createdBy: "user_xyz"
}
```

**Errors:** `404` if not found or belongs to another org.

---

#### `PUT /api/pdfme/templates/:id/draft`

Save the current draft schema. If the template is published and the user has not chosen a save mode, the response indicates that a save mode must be selected.

**Permission:** `template:edit`

**Request Body:**

```typescript
{
  schema: { /* pdfme Template JSON */ },  // required — full template schema
  saveMode: "inPlace" | "newVersion"      // required when template status is 'published'
}
```

**Response:** `200 OK`

```typescript
{
  id: "clxyz123",
  version: 4,               // incremented if saveMode was 'newVersion'
  status: "draft" | "published",
  updatedAt: "2026-03-18T09:15:00Z"
}
```

**Errors:** `409` if template is locked by another user. `400` if `saveMode` is missing when template is published.

---

#### `POST /api/pdfme/templates/:id/publish`

Promote the current draft to published status.

**Permission:** `template:publish`

**Response:** `200 OK`

```typescript
{
  id: "clxyz123",
  version: 4,
  publishedVer: 4,
  status: "published",
  updatedAt: "2026-03-18T09:20:00Z"
}
```

**Errors:** `422 Unprocessable Entity` if template validation fails (see Section 23). Response body includes:

```typescript
{
  statusCode: 422,
  error: "Unprocessable Entity",
  message: "Template validation failed — 2 errors must be resolved before publishing",
  details: {
    valid: false,
    errors: [
      { rule: "binding_check", elementName: "customerVat", message: "Field binding {{customer.vatNo}} does not exist in field schema. Did you mean {{customer.vatNumber}}?", suggestion: "{{customer.vatNumber}}" }
    ],
    warnings: [ /* ... */ ]
  }
}
```

---

#### `POST /api/pdfme/templates/:id/fork`

Fork a system template (or another org template, if the org owns it) into the current org's namespace as a new draft.

**Permission:** `template:fork`

**Request Body:**

```typescript
{
  name?: "My Forked Invoice"    // optional — defaults to "{original name} (Copy)"
}
```

**Response:** `201 Created` — same shape as `POST /api/pdfme/templates` response, with `forkedFromId` populated.

---

#### `GET /api/pdfme/templates/:id/versions`

List all versions of a template.

**Permission:** `template:view`

**Response:** `200 OK`

```typescript
{
  data: [
    {
      version: 4,
      status: "published",
      saveMode: "newVersion",
      savedBy: "user_xyz",
      savedAt: "2026-03-18T09:15:00Z",
      isCurrent: true
    },
    {
      version: 3,
      status: "archived",
      saveMode: "inPlace",
      savedBy: "user_xyz",
      savedAt: "2026-03-01T11:00:00Z",
      isCurrent: false
    }
  ]
}
```

---

#### `POST /api/pdfme/templates/:id/restore`

Restore a historical version as a new draft.

**Permission:** `template:edit`

**Request Body:**

```typescript
{
  version: 2    // required — the version number to restore
}
```

**Response:** `201 Created` — returns the new draft template record.

---

#### `DELETE /api/pdfme/templates/:id`

Archive a template (soft delete — sets status to `archived`).

**Permission:** `template:delete`

**Response:** `204 No Content`

---

#### `GET /api/pdfme/templates/system`

List all system templates available for forking.

**Permission:** `template:view`

**Query Parameters:** `type` (optional filter)

**Response:** `200 OK` — same shape as `GET /api/pdfme/templates` but only returns records with `orgId: null`.

---

#### `GET /api/pdfme/templates/system/:id`

Get a system template's full schema JSON.

**Permission:** `template:view`

**Response:** `200 OK` — same shape as `GET /api/pdfme/templates/:id`.

---

#### `POST /api/pdfme/templates/import`

Import a template from a `TemplateExportPackage` JSON.

**Permission:** `template:import`

**Request Body:** `TemplateExportPackage` JSON (see Section 26.1)

**Response:** `201 Created`

```typescript
{
  templateId: "clxyz789",
  name: "Imported Invoice Template",
  status: "draft",
  validation: {
    valid: true,
    warnings: [ /* any binding warnings against the importing org's field schema */ ]
  },
  importedAssets: {
    fonts: 2,
    images: 1
  }
}
```

---

#### `POST /api/pdfme/templates/:id/validate`

Run the validation suite against the template without publishing.

**Permission:** `template:edit`

**Response:** `200 OK`

```typescript
{
  valid: boolean,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
  info: ValidationIssue[]
}
```

---

#### `POST /api/pdfme/templates/:id/preview`

Generate a preview PDF using sample data.

**Permission:** `template:edit`

**Request Body:**

```typescript
{
  sampleRowCount?: 5 | 15 | 30,   // line items count. Default: 5
  channel?: "email" | "print"      // output channel. Default: "email"
}
```

**Response:** `200 OK`

```typescript
{
  previewId: "prev_abc123",
  downloadUrl: "/api/pdfme/render/download/prev_abc123",
  expiresAt: "2026-03-18T10:15:00Z"  // temporary — auto-purged
}
```

---

#### `POST /api/pdfme/templates/:id/lock`

Acquire or renew an edit lock on a template. Also used as a heartbeat (call every 5 minutes while editing).

**Permission:** `template:edit`

**Response:** `200 OK`

```typescript
{
  locked: true,
  lockedBy: "user_xyz",
  lockedAt: "2026-03-18T09:00:00Z",
  expiresAt: "2026-03-18T09:30:00Z"
}
```

**Errors:** `409 Conflict` if locked by another user:

```typescript
{
  statusCode: 409,
  error: "Conflict",
  message: "Template is locked by another user",
  details: {
    lockedBy: { userId: "user_abc", name: "Jane Smith" },
    lockedAt: "2026-03-18T08:45:00Z",
    expiresAt: "2026-03-18T09:15:00Z"
  }
}
```

---

#### `DELETE /api/pdfme/templates/:id/lock`

Release an edit lock. Users can only release their own lock unless they have `template:publish` permission (force release).

**Permission:** `template:edit` (own lock) or `template:publish` (any lock)

**Response:** `204 No Content`

---

### 34.3 Render Endpoints

#### `POST /api/pdfme/render/now`

Render a single document synchronously. Returns when the PDF is ready.

**Permission:** `render:trigger`

**Request Body:**

```typescript
{
  templateType: "invoice",        // required
  entityId: "inv_2024_00891",     // required — FK to the source record in the host ERP
  channel: "email" | "print",     // required
  locale?: "en-ZA"                // optional — overrides org default locale
}
```

**Response:** `201 Created`

```typescript
{
  documentId: "doc_abc123",
  templateId: "clxyz123",
  templateVer: 3,
  entityType: "invoice",
  entityId: "inv_2024_00891",
  outputChannel: "email",
  downloadUrl: "/api/pdfme/render/download/doc_abc123",
  pdfHash: "sha256:a1b2c3d4...",
  createdAt: "2026-03-18T09:30:00Z"
}
```

**Errors:** `400` if template type has no published template for this org. `500` if render fails (body includes error details).

---

#### `POST /api/pdfme/render/queue`

Queue a single document for async rendering. Returns immediately.

**Permission:** `render:trigger`

**Request Body:** Same as `POST /api/pdfme/render/now`

**Response:** `202 Accepted`

```typescript
{
  jobId: "job_xyz789",
  status: "queued",
  statusUrl: "/api/pdfme/render/status/job_xyz789"
}
```

---

#### `POST /api/pdfme/render/bulk`

Queue a batch of documents for rendering.

**Permission:** `render:bulk`

**Request Body:**

```typescript
{
  templateType: "statement",          // required
  entityIds: ["cust_001", "cust_002", "cust_003"],  // required — max 2,000
  channel: "email" | "print",        // required
  onFailure?: "continue" | "abort",  // optional — default: "continue"
  notifyUrl?: "https://erp.local/webhooks/render-complete",  // optional — webhook callback
  locale?: "en-ZA"                   // optional
}
```

**Response:** `202 Accepted`

```typescript
{
  batchId: "batch_abc456",
  totalJobs: 3,
  status: "running",
  statusUrl: "/api/pdfme/render/batch/batch_abc456",
  progressUrl: "/api/pdfme/render/batch/batch_abc456/progress"
}
```

---

#### `GET /api/pdfme/render/status/:jobId`

Poll the status of a single queued render job.

**Permission:** `render:trigger`

**Response:** `200 OK`

```typescript
{
  jobId: "job_xyz789",
  status: "queued" | "generating" | "done" | "failed",
  documentId?: "doc_abc123",           // present when status is 'done'
  downloadUrl?: "/api/pdfme/render/download/doc_abc123",
  error?: "DataSource error: Invoice not found",  // present when status is 'failed'
  createdAt: "2026-03-18T09:30:00Z",
  completedAt?: "2026-03-18T09:30:45Z"
}
```

---

#### `GET /api/pdfme/render/batch/:batchId`

Get the aggregate status of a bulk render batch.

**Permission:** `render:bulk`

**Response:** `200 OK`

```typescript
{
  batchId: "batch_abc456",
  status: "running" | "completed" | "completedWithErrors" | "aborted",
  totalJobs: 200,
  completedJobs: 197,
  failedJobs: 3,
  failedEntityIds: ["cust_045", "cust_112", "cust_189"],
  failedDetails: [
    { entityId: "cust_045", error: "DataSource error: customer not found" },
    { entityId: "cust_112", error: "Expression evaluation error in element 'discountCalc'" },
    { entityId: "cust_189", error: "Font 'CustomSerif' not found, fallback used but PDF/A validation failed" }
  ],
  createdAt: "2026-03-18T10:00:00Z",
  completedAt: "2026-03-18T10:12:30Z" | null
}
```

---

#### `GET /api/pdfme/render/batch/:batchId/progress`

Server-Sent Events (SSE) endpoint for real-time batch progress.

**Permission:** `render:bulk`

**Response:** `200 OK` with `Content-Type: text/event-stream`

```
data: {"type":"progress","completed":50,"failed":1,"total":200}

data: {"type":"progress","completed":100,"failed":2,"total":200}

data: {"type":"done","status":"completedWithErrors","completed":197,"failed":3,"total":200}
```

---

#### `POST /api/pdfme/render/batch/:batchId/merge`

Merge all successfully generated PDFs from a batch into a single PDF file.

**Permission:** `render:bulk`

**Request Body:**

```typescript
{
  insertSeparatorPage?: boolean    // optional — insert blank page between documents. Default: false
}
```

**Response:** `201 Created`

```typescript
{
  mergedDocumentId: "doc_merged_001",
  downloadUrl: "/api/pdfme/render/download/doc_merged_001",
  pageCount: 594,
  documentCount: 197,
  sizeBytes: 12450000
}
```

---

#### `GET /api/pdfme/render/download/:documentId`

Stream a generated PDF file. This is the primary endpoint the host ERP uses to serve PDFs to end users.

**Permission:** `render:trigger`

**Response:** `200 OK`

```
Content-Type: application/pdf
Content-Disposition: inline; filename="INV-2024-00891.pdf"
Content-Length: 45230
X-PDF-Hash: sha256:a1b2c3d4...

<binary PDF data>
```

**Query Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| disposition | string | No | `inline` (default — display in browser) or `attachment` (force download) |
| filename | string | No | Override the download filename |

**Errors:** `404` if document not found or belongs to another org. `410 Gone` if the document was a temporary preview that has expired.

---

#### `GET /api/pdfme/render/verify/:documentId`

Verify the integrity of a generated PDF by recomputing its SHA-256 hash and comparing against the stored hash.

**Permission:** `render:trigger`

**Response:** `200 OK`

```typescript
{
  documentId: "doc_abc123",
  verified: true | false,
  storedHash: "sha256:a1b2c3d4...",
  computedHash: "sha256:a1b2c3d4...",
  match: true,
  verifiedAt: "2026-03-18T11:00:00Z"
}
```

---

#### `GET /api/pdfme/render/history`

Query the history of generated documents.

**Permission:** `render:trigger`

**Query Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| templateType | string | No | Filter by type |
| entityId | string | No | Filter by source entity |
| from | string | No | ISO 8601 date — start of range |
| to | string | No | ISO 8601 date — end of range |
| status | string | No | Filter by status: `done`, `failed`, `generating` |
| limit | number | No | Default: `20`, max: `100` |
| cursor | string | No | Pagination cursor |

**Response:** `200 OK`

```typescript
{
  data: [
    {
      documentId: "doc_abc123",
      templateId: "clxyz123",
      templateVer: 3,
      entityType: "invoice",
      entityId: "inv_2024_00891",
      outputChannel: "email",
      status: "done",
      downloadUrl: "/api/pdfme/render/download/doc_abc123",
      pdfHash: "sha256:a1b2c3d4...",
      triggeredBy: "user_xyz",
      createdAt: "2026-03-18T09:30:00Z"
    }
  ],
  pagination: { total: 45, limit: 20, cursor: "clxyz999", hasMore: true }
}
```

---

### 34.4 Asset Endpoints

#### `POST /api/pdfme/assets/upload`

Upload an image, font, or brand asset.

**Permission:** `template:edit`

**Request:** `Content-Type: multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| file | File | Yes | The file to upload |
| category | string | No | `image`, `font`, `brand`. Default: auto-detected from MIME type |
| label | string | No | Human-readable label for the asset |

**Response:** `201 Created`

```typescript
{
  assetId: "asset_abc123",
  fileName: "company-logo.png",
  category: "image",
  mimeType: "image/png",
  sizeBytes: 24500,
  label: "Company Logo",
  downloadUrl: "/api/pdfme/assets/asset_abc123",
  createdAt: "2026-03-18T09:00:00Z"
}
```

**Errors:** `400` if font has restrictive fsType flag. `400` if file exceeds size limit (10MB for fonts, 5MB for images). `413` if tenant storage quota exceeded.

---

#### `GET /api/pdfme/assets`

List all assets for the authenticated org.

**Permission:** `template:view`

**Query Parameters:** `category` (optional: `image`, `font`, `brand`), `search`, `limit`, `cursor`

**Response:** `200 OK`

```typescript
{
  data: [
    {
      assetId: "asset_abc123",
      fileName: "company-logo.png",
      category: "image",
      mimeType: "image/png",
      sizeBytes: 24500,
      label: "Company Logo",
      downloadUrl: "/api/pdfme/assets/asset_abc123",
      metadata: { width: 400, height: 120 } | { fontFamily: "Inter", fontWeight: "400", fontStyle: "normal" },
      createdAt: "2026-03-18T09:00:00Z"
    }
  ],
  pagination: { total: 8, limit: 20, hasMore: false }
}
```

---

#### `GET /api/pdfme/assets/:assetId`

Download/stream an asset file.

**Permission:** `template:view`

**Response:** `200 OK` with appropriate `Content-Type` header and binary data.

---

#### `DELETE /api/pdfme/assets/:assetId`

Delete an asset. The service checks whether any published template references this asset and returns a warning (but does not block deletion).

**Permission:** `template:edit`

**Response:** `200 OK`

```typescript
{
  deleted: true,
  warnings: [
    "Asset is referenced by published template 'Standard Tax Invoice' (clxyz123). The template will fall back to a placeholder image."
  ] | []
}
```

---

### 34.5 Signature Endpoints

#### `POST /api/pdfme/signatures`

Upload a drawn signature for the authenticated user.

**Permission:** Any authenticated user (users can only manage their own signature)

**Request:** `Content-Type: multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| file | File | Yes | Transparent-background PNG of the signature |

**Response:** `201 Created`

```typescript
{
  signatureId: "sig_abc123",
  userId: "user_xyz",
  capturedAt: "2026-03-18T09:00:00Z"
}
```

---

#### `GET /api/pdfme/signatures/me`

Get the current user's active signature (for preview in the Signature Manager).

**Permission:** Any authenticated user

**Response:** `200 OK`

```typescript
{
  signatureId: "sig_abc123",
  userId: "user_xyz",
  capturedAt: "2026-03-18T09:00:00Z",
  previewUrl: "/api/pdfme/signatures/sig_abc123/preview"
}
```

**Errors:** `404` if no signature on file.

---

#### `GET /api/pdfme/signatures/:signatureId/preview`

Stream the signature image for preview purposes.

**Permission:** Any authenticated user (own signature) or `template:edit` (any org user's signature for template preview)

**Response:** `200 OK` with `Content-Type: image/png`.

---

#### `DELETE /api/pdfme/signatures/me`

Revoke the current user's signature (sets `revokedAt`).

**Permission:** Any authenticated user

**Response:** `204 No Content`

---

### 34.6 Backup Endpoints

#### `POST /api/pdfme/backup/export`

Generate a full backup ZIP of the org's template configuration.

**Permission:** `template:import` (reusing for admin-level backup access)

**Response:** `201 Created`

```typescript
{
  backupId: "bak_abc123",
  downloadUrl: "/api/pdfme/render/download/bak_abc123",
  expiresAt: "2026-03-18T10:00:00Z",    // temporary — auto-purged after 1 hour
  contents: {
    templates: 5,
    assets: 12,
    fonts: 3,
    signatures: 2
  }
}
```

---

#### `POST /api/pdfme/backup/import`

Import a backup ZIP into the org.

**Permission:** `template:import`

**Request:** `Content-Type: multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| file | File | Yes | The backup ZIP archive |

**Response:** `201 Created`

```typescript
{
  imported: {
    templates: { created: 5, skipped: 0, failed: 0 },
    assets: { created: 10, deduplicated: 2, failed: 0 },
    fonts: { created: 3, deduplicated: 0, failed: 0 },
    signatures: { created: 1, skipped: 1, reason: "User user_abc not found in target org" }
  },
  warnings: [
    "Signature for user_abc was skipped — user does not exist in this organisation"
  ]
}
```

---

### 34.7 Audit Endpoints

#### `GET /api/pdfme/audit`

Query the audit log.

**Permission:** `template:publish` (admin-level access)

**Query Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| entityType | string | No | `template`, `generatedDocument`, `signature` |
| entityId | string | No | Filter by specific entity |
| action | string | No | `created`, `updated`, `published`, `archived`, `forked`, `rendered`, `deleted` |
| userId | string | No | Filter by acting user |
| from | string | No | ISO 8601 date — start of range |
| to | string | No | ISO 8601 date — end of range |
| limit | number | No | Default: `50`, max: `200` |
| cursor | string | No | Pagination cursor |

**Response:** `200 OK`

```typescript
{
  data: [
    {
      id: "audit_001",
      entityType: "template",
      entityId: "clxyz123",
      action: "published",
      userId: "user_xyz",
      metadata: { version: 4, saveMode: "newVersion" },
      createdAt: "2026-03-18T09:20:00Z"
    }
  ],
  pagination: { total: 340, limit: 50, cursor: "audit_051", hasMore: true }
}
```

---

### 34.8 Field Schema Endpoint

#### `GET /api/pdfme/field-schema/:templateType`

Get the field schema for a given template type. This is the data structure that populates the Fields tab in the designer. The host ERP registers field schemas for each template type via the NestJS module configuration.

**Permission:** `template:view`

**Response:** `200 OK`

```typescript
{
  templateType: "invoice",
  fieldGroups: FieldGroup[]   // see Section 3.3.2 for FieldGroup type definition
}
```

> Integration note: The host ERP must register field schemas at module initialisation time by calling `FieldSchemaRegistry.register(templateType, fieldGroups)`. This is how the pdfme module knows which fields are available for each document type. The field schema endpoint simply returns the registered schema — the pdfme module does not generate field schemas itself.

---

### 34.9 Health & Configuration Endpoints

#### `GET /api/pdfme/health`

Health check endpoint for load balancers and monitoring.

**Permission:** None (unauthenticated)

**Response:** `200 OK`

```typescript
{
  status: "ok",
  version: "1.2.0",
  uptime: 86400,
  storage: {
    available: true,
    rootDir: "/var/lib/pdfme-erp/storage"
  },
  queue: {
    available: true,
    activeJobs: 3,
    waitingJobs: 12
  },
  database: {
    available: true
  }
}
```

---

#### `GET /api/pdfme/config`

Get the module configuration relevant to the frontend designer. This is called once when the designer loads to configure itself.

**Permission:** Any authenticated user

**Response:** `200 OK`

```typescript
{
  availablePageSizes: [
    { id: "a4", label: "A4", width: 210, height: 297 },
    { id: "letter", label: "US Letter", width: 215.9, height: 279.4 },
    { id: "a5", label: "A5", width: 148, height: 210 },
    { id: "legal", label: "US Legal", width: 215.9, height: 355.6 }
  ],
  availableFonts: [
    { family: "Inter", weights: ["400", "500", "600", "700"], source: "system" },
    { family: "Noto Sans", weights: ["400", "700"], source: "system" },
    { family: "Custom Corp Font", weights: ["400", "700"], source: "tenant", downloadUrl: "/api/pdfme/assets/asset_font_001" }
  ],
  maxUploadSizeBytes: {
    image: 5242880,
    font: 10485760
  },
  features: {
    pdfUA: false,
    richText: true,
    groupedReports: true
  },
  localeConfig: {
    locale: "en-ZA",
    currency: { code: "ZAR", symbol: "R", symbolPosition: "prefix", decimalSeparator: ".", thousandsSeparator: ",", decimalPlaces: 2 },
    date: { shortFormat: "dd/MM/yyyy", longFormat: "dd MMMM yyyy" },
    number: { decimalSeparator: ".", thousandsSeparator: "," }
  }
}
```

---

### 34.10 NestJS Module Registration

The host ERP integrates the pdfme module by importing it in its root AppModule:

```typescript
import { PdfmeErpModule } from '@pdfme-erp/nest';

@Module({
  imports: [
    PdfmeErpModule.register({
      // File storage configuration
      storage: {
        rootDir: process.env.PDFME_STORAGE_DIR || '/var/lib/pdfme-erp/storage',
        tempDir: process.env.PDFME_TEMP_DIR || '/var/lib/pdfme-erp/tmp',
        tempRetentionMinutes: 60,
      },

      // JWT configuration — must match the host ERP's JWT setup
      jwt: {
        secret: process.env.JWT_SECRET,        // or publicKey for RS256
        algorithm: 'HS256',                     // or 'RS256'
        claimsMapping: {
          userId: 'sub',                        // JWT claim for user ID
          orgId: 'orgId',                       // JWT claim for tenant ID
          roles: 'roles',                       // JWT claim for permission array
        },
      },

      // Redis connection for Bull queue
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },

      // Database — uses the host app's Prisma client
      prisma: {
        client: PrismaService,                  // the host ERP's PrismaService class
      },

      // API prefix — all endpoints mounted under this path
      apiPrefix: '/api/pdfme',

      // Rate limiting
      rateLimits: {
        renderNow: { max: 60, windowSeconds: 60 },
        renderQueue: { max: 120, windowSeconds: 60 },
        renderBulk: { max: 5, windowSeconds: 3600 },
        bulkMaxEntityIds: 2000,
      },

      // Per-tenant storage quotas
      quotas: {
        documentsBytes: 5 * 1024 * 1024 * 1024,  // 5GB
        assetsBytes: 500 * 1024 * 1024,            // 500MB
      },

      // Queue concurrency
      queue: {
        defaultConcurrency: 5,
        maxConcurrency: 20,
      },

      // Ghostscript path for PDF/A conversion
      ghostscript: {
        binary: process.env.GS_BINARY || '/usr/bin/gs',
      },

      // veraPDF path for PDF/A validation
      verapdf: {
        binary: process.env.VERAPDF_BINARY || '/usr/bin/verapdf',
      },
    }),
  ],
})
export class AppModule {}
```

#### 34.10.1 DataSource Registration

The host ERP registers DataSource implementations for each template type. These are the services that resolve ERP domain data into pdfme inputs:

```typescript
import { DataSourceRegistry } from '@pdfme-erp/nest';

@Module({
  providers: [
    InvoiceDataSource,
    StatementDataSource,
    PurchaseOrderDataSource,
    DeliveryNoteDataSource,
    CreditNoteDataSource,
    AgedDebtorsDataSource,
    StockOnHandDataSource,
    SalesSummaryDataSource,
  ],
})
export class ErpDocumentsModule implements OnModuleInit {
  constructor(
    private readonly registry: DataSourceRegistry,
    private readonly invoiceDs: InvoiceDataSource,
    private readonly statementDs: StatementDataSource,
    // ... other DataSources
  ) {}

  onModuleInit() {
    this.registry.register(this.invoiceDs);
    this.registry.register(this.statementDs);
    // ... register all DataSources
  }
}
```

#### 34.10.2 Field Schema Registration

Similarly, the host ERP registers field schemas that power the designer's Fields tab:

```typescript
import { FieldSchemaRegistry } from '@pdfme-erp/nest';

@Module({})
export class ErpFieldSchemaModule implements OnModuleInit {
  constructor(private readonly registry: FieldSchemaRegistry) {}

  onModuleInit() {
    this.registry.register('invoice', invoiceFieldSchema);
    this.registry.register('statement', statementFieldSchema);
    this.registry.register('purchase_order', purchaseOrderFieldSchema);
    // ... register all field schemas
  }
}
```

#### 34.10.3 Prisma Schema Migration

The pdfme module requires its database tables to be present. The module exports a Prisma schema fragment that the host ERP merges into its own `schema.prisma` file:

```bash
# Copy the pdfme Prisma models into the host app's schema
npx pdfme-erp prisma:merge --output ./prisma/schema.prisma

# Then run the standard Prisma migration
npx prisma migrate dev --name add-pdfme-tables
```

The models added are: `Template`, `GeneratedDocument`, `UserSignature`, `RenderBatch`, `AuditLog`.

---

### 34.11 Frontend Integration — Designer Component

The host ERP mounts the designer as a full-page React component:

```tsx
import { ErpDesigner } from '@pdfme/ui';
import type { ErpDesignerProps } from '@pdfme/ui';

export default function TemplateDesignerPage({ params }: { params: { id: string } }) {
  const { data: template } = useQuery(['template', params.id], () =>
    fetch(`/api/pdfme/templates/${params.id}`).then(r => r.json())
  );
  const { data: config } = useQuery(['pdfme-config'], () =>
    fetch('/api/pdfme/config').then(r => r.json())
  );
  const { data: fieldSchema } = useQuery(['field-schema', template?.type], () =>
    fetch(`/api/pdfme/field-schema/${template?.type}`).then(r => r.json())
  );

  if (!template || !config || !fieldSchema) return <Loading />;

  return (
    <ErpDesigner
      template={template.schema}
      fieldSchema={fieldSchema.fieldGroups}
      templateContext={template.type}
      brandConfig={{
        primaryColour: orgSettings.primaryColour,
        logoUrl: `/api/pdfme/assets/${orgSettings.logoAssetId}`,
        fonts: config.availableFonts,
      }}
      localeConfig={config.localeConfig}
      permissions={{
        canPublish: userRoles.includes('template:publish'),
        canDelete: userRoles.includes('template:delete'),
        canExportJson: true,
      }}
      onSaveDraft={async (schema) => {
        await fetch(`/api/pdfme/templates/${params.id}/draft`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({ schema, saveMode: 'inPlace' }),
        });
      }}
      onPublish={async (schema) => {
        await fetch(`/api/pdfme/templates/${params.id}/publish`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${jwt}` },
        });
      }}
      onAssetUpload={async (file) => {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/pdfme/assets/upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${jwt}` },
          body: form,
        });
        const { downloadUrl } = await res.json();
        return downloadUrl;
      }}
      onGeneratePreview={async (schema) => {
        const res = await fetch(`/api/pdfme/templates/${params.id}/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({ sampleRowCount: 15 }),
        });
        const { downloadUrl } = await res.json();
        return downloadUrl;
      }}
    />
  );
}
```

---

### 34.12 Integration Checklist

The following checklist summarises what the host ERP must provide for a complete integration:

| Requirement | Owner | Description |
|---|---|---|
| JWT authentication | Host ERP | Issue JWTs with `sub`, `orgId`, and `roles` claims |
| Prisma schema merge | Host ERP | Merge pdfme Prisma models and run migrations |
| DataSource implementations | Host ERP | One per template type — resolves domain data into pdfme `inputs[]` |
| Field schema registration | Host ERP | One per template type — defines available fields for the designer |
| Redis instance | Infrastructure | Required for Bull queue — can be shared with other host ERP queues |
| PostgreSQL | Infrastructure | Shared with host ERP database |
| Storage directory | Infrastructure | Writable directory for file storage — local disk or NAS mount |
| Ghostscript binary | Infrastructure | Required for PDF/A-3b compliance |
| veraPDF binary | Infrastructure | Required for PDF/A validation |
| Bundled fonts | Infrastructure | `/app/fonts/` directory with open-licence font files |
| Designer page | Host ERP | Next.js page that mounts the `ErpDesigner` component |
| Route proxying | Host ERP | Ensure `/api/pdfme/*` routes reach the NestJS pdfme module |
