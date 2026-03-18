# pdfme ERP Edition

A forked, extended build of the open-source [pdfme](https://pdfme.com) library tailored as the document design and report generation engine within a NestJS/Next.js ERP platform.

## Overview

pdfme ERP Edition provides:

- **WYSIWYG Template Designer** — Three-panel layout (Figma/Notion aesthetic) for designing ERP documents
- **ERP Document Types** — Invoices, statements, purchase orders, delivery notes, credit notes
- **Operational Reports** — Aged debtors, stock on hand, sales analysis with grouped table layouts
- **Multi-tenancy** — Full org-level isolation for all data and assets
- **PDF/A-3b Compliance** — Ghostscript conversion + veraPDF validation
- **Expression Engine** — Arithmetic, string, conditional, date, and locale-aware functions
- **REST API** — Comprehensive API designed for seamless ERP integration

## Architecture

```
pdfme-erp/
├── packages/
│   ├── common/              ← upstream (unmodified)
│   ├── generator/           ← upstream (unmodified)
│   ├── schemas/             ← upstream base schemas
│   ├── ui/                  ← FORKED — redesigned designer UI
│   └── erp-schemas/         ← NEW — ERP schema plugins
├── nest-module/             ← NEW — NestJS integration
├── apps/
│   └── designer-sandbox/    ← Next.js dev harness
└── package.json             ← npm workspaces
```

## Technology Stack

- **Frontend**: Next.js (App Router), React, Tailwind CSS, shadcn/ui, dnd-kit
- **Backend**: NestJS, Node.js (TypeScript), Drizzle ORM
- **Database**: PostgreSQL 15+
- **Queue**: Bull (Redis-backed) for async PDF generation
- **PDF Engine**: pdfme generate() → Ghostscript (PDF/A-3b) → veraPDF validation

## Prerequisites

- Node.js LTS (20+)
- PostgreSQL 15+
- Redis 7+
- Ghostscript (for PDF/A-3b conversion)
- veraPDF (for PDF/A validation, optional for development)

## Getting Started

```bash
# Install dependencies and build
./init.sh

# Run tests
npm test
```

## ERP Schema Plugins

| Plugin | Description |
|--------|-------------|
| Line Items Table | Dynamic rows, page breaks, header repeat, footer rows |
| Grouped Table | Hierarchical reports with up to 3 groupBy levels |
| ERP Image | Storage-resolved logos and stamps |
| Signature Block | Signature line with configurable label |
| Drawn Signature | Real signature embedding from file storage |
| Watermark | DRAFT/COPY/VOID diagonal overlay |
| Calculated Field | Expression-evaluated with format string |
| Rich Text | HTML-subset with WYSIWYG editor |
| QR/Barcode | QR code with ERP URL binding |

## API Endpoints

All under configurable prefix (default: `/api/pdfme`)

- **Templates**: CRUD, versioning, forking, locking, validation, import/export
- **Render**: Synchronous, async (queue), bulk (batch), SSE progress, PDF merge
- **Assets**: Upload, list, download, delete (images, fonts)
- **Signatures**: Upload, preview, revoke
- **Backup**: Full org export/import as ZIP
- **Audit**: Append-only audit trail query

## License

MIT
