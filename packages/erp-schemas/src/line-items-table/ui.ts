/**
 * Line Items Table - Enhanced UI renderer for the designer canvas.
 *
 * Renders a realistic table preview in the DOM when the element is displayed
 * in the pdfme Designer/Viewer/Form UI. Shows column headers with type
 * indicators, sample body rows with intelligent placeholders, footer rows,
 * serial/lot tracking sub-rows, and visual styling matching the configured
 * schema properties.
 *
 * The preview updates in real-time as columns are added/removed/modified
 * because the pdfme framework re-calls uiRender whenever the schema changes.
 */

// ─── Types ──────────────────────────────────────────────────────────

interface ColumnDef {
  key: string;
  header: string;
  width: number;
  align?: string;
  format?: string;
  columnType?: 'field' | 'calculated' | 'static';
  expression?: string;
  columnStyle?: {
    fontName?: string;
    fontSize?: number;
    fontColor?: string;
    bold?: boolean;
    italic?: boolean;
  };
  headerColumnStyle?: {
    fontName?: string;
    fontSize?: number;
    fontColor?: string;
    bold?: boolean;
    italic?: boolean;
  };
}

interface FooterRowDef {
  id: string;
  label: string;
  labelColumnKey?: string;
  valueColumnKey: string;
  type: string;
  format?: string;
  style?: {
    fontWeight?: string;
    fontSize?: number;
    borderBottom?: string;
  };
  labelColSpan?: number;
}

// ─── Sample data generators ─────────────────────────────────────────

/** Sample values keyed by common column keys */
const SAMPLE_VALUES: Record<string, string[]> = {
  description: ['Widget Pro X500', 'Service: Installation', 'Mounting Bracket Kit'],
  qty: ['3', '1', '5'],
  quantity: ['3', '1', '5'],
  unitPrice: ['150.00', '250.00', '45.00'],
  unit_price: ['150.00', '250.00', '45.00'],
  price: ['150.00', '250.00', '45.00'],
  amount: ['450.00', '250.00', '225.00'],
  total: ['450.00', '250.00', '225.00'],
  line_total: ['450.00', '250.00', '225.00'],
  lineTotal: ['450.00', '250.00', '225.00'],
  code: ['WDG-X500', 'SVC-INST', 'BRK-MNT'],
  itemCode: ['WDG-X500', 'SVC-INST', 'BRK-MNT'],
  item_code: ['WDG-X500', 'SVC-INST', 'BRK-MNT'],
  vat: ['15%', '15%', '0%'],
  vatRate: ['15%', '15%', '0%'],
  vat_rate: ['15%', '15%', '0%'],
  tax: ['67.50', '37.50', '0.00'],
  discount: ['0%', '10%', '5%'],
  uom: ['ea', 'hr', 'set'],
};

/** Generate a sample value for a column based on its key and row index */
function getSampleValue(col: ColumnDef, rowIndex: number): string {
  const colType = col.columnType || 'field';

  // Static columns show their key value directly
  if (colType === 'static') {
    return col.key || '';
  }

  // Calculated columns show a formula indicator
  if (colType === 'calculated') {
    if (col.expression) {
      // Show simplified result based on common expressions
      const expr = col.expression.trim().toLowerCase();
      if (expr.includes('*')) {
        const values = ['450.00', '250.00', '225.00'];
        return col.format ? values[rowIndex % values.length] : values[rowIndex % values.length];
      }
      return ['calc', 'calc', 'calc'][rowIndex % 3];
    }
    return 'calc';
  }

  // Field columns — check known sample values
  const key = col.key.toLowerCase().replace(/[_\-.]/g, '');
  for (const [sampleKey, values] of Object.entries(SAMPLE_VALUES)) {
    if (key === sampleKey.toLowerCase().replace(/[_\-.]/g, '') || key.includes(sampleKey.toLowerCase().replace(/[_\-.]/g, ''))) {
      return values[rowIndex % values.length];
    }
  }

  // Fallback based on format
  if (col.format) {
    if (col.format.includes('#') || col.format.includes('0')) {
      const nums = ['100.00', '50.00', '75.00'];
      return nums[rowIndex % nums.length];
    }
  }

  // Generic fallback based on alignment
  if (col.align === 'right') {
    const nums = ['100.00', '50.00', '75.00'];
    return nums[rowIndex % nums.length];
  }

  // Text-like columns
  const texts = [`Item ${rowIndex + 1}`, `Item ${rowIndex + 1}`, `Item ${rowIndex + 1}`];
  return texts[rowIndex % texts.length];
}

// ─── Column type indicator SVG paths ────────────────────────────────

/** Tiny 8×8 icon rendered inline in headers to indicate column type */
function createTypeIndicator(
  colType: 'field' | 'calculated' | 'static',
  color: string,
): HTMLElement {
  const span = document.createElement('span');
  span.style.display = 'inline-flex';
  span.style.alignItems = 'center';
  span.style.marginRight = '2px';
  span.style.verticalAlign = 'middle';
  span.style.opacity = '0.7';
  span.style.fontSize = '7px';
  span.style.fontWeight = 'bold';
  span.style.color = color;

  switch (colType) {
    case 'calculated':
      span.textContent = 'fx';
      span.style.fontStyle = 'italic';
      span.style.color = '#fbbf24'; // amber
      break;
    case 'static':
      span.textContent = 'T';
      span.style.color = '#34d399'; // emerald
      break;
    case 'field':
    default:
      // No indicator for field type (default) — keep headers clean
      span.style.display = 'none';
      break;
  }

  return span;
}

// ─── Main render function ───────────────────────────────────────────

/**
 * Render a line items table preview into the given root element.
 * This is called by pdfme's UI layer (Designer, Viewer, Form).
 */
export function uiRender(arg: {
  schema: Record<string, unknown>;
  value: string;
  rootElement: HTMLDivElement;
  mode: string;
  onChange?: (v: { key: string; value: unknown } | { key: string; value: unknown }[]) => void;
}): void {
  const { schema, value, rootElement } = arg;
  rootElement.innerHTML = '';

  // ─── Extract schema configuration ───────────────────────────────
  const columns = (schema.columns as ColumnDef[]) || [];
  const showHeader = schema.showHeader !== false;
  const alternateRowShading = schema.alternateRowShading === true;
  const alternateRowColor = (schema.alternateRowColor as string) || '#f7fafc';
  const headerBg = ((schema.headerStyle as Record<string, unknown>)?.backgroundColor as string) || '#2d3748';
  const bodyFontSize = ((schema.bodyStyle as Record<string, unknown>)?.fontSize as number) || 8;
  const headerFontSize = ((schema.headerStyle as Record<string, unknown>)?.fontSize as number) || 9;
  const footerRows = (schema.footerRows as FooterRowDef[]) || [];
  const showTrackingDetails = schema.showTrackingDetails === true;
  const trackingDetailStyle = (schema.trackingDetailStyle as Record<string, unknown>) || {};

  // ─── Parse or generate body data ────────────────────────────────
  let bodyRows: string[][] = [];
  if (value) {
    try {
      bodyRows = JSON.parse(value);
    } catch {
      bodyRows = [];
    }
  }

  // Generate intelligent sample rows when no data
  const SAMPLE_ROW_COUNT = 3;
  const isUsingPlaceholders = bodyRows.length === 0;
  if (isUsingPlaceholders) {
    for (let r = 0; r < SAMPLE_ROW_COUNT; r++) {
      bodyRows.push(columns.map((col) => getSampleValue(col, r)));
    }
  }

  // ─── Container ──────────────────────────────────────────────────
  const container = document.createElement('div');
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.overflow = 'hidden';
  container.style.fontFamily = 'Arial, sans-serif';
  container.style.boxSizing = 'border-box';
  container.style.border = '0.5px solid #000';
  container.style.position = 'relative';

  // Calculate total width for proportional column sizing
  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0) || 1;

  // Track content height for overflow detection
  let contentHeight = 0;

  // ─── Header row ─────────────────────────────────────────────────
  if (showHeader && columns.length > 0) {
    const headerRow = document.createElement('div');
    headerRow.style.display = 'flex';
    headerRow.style.backgroundColor = headerBg;
    headerRow.style.color = '#ffffff';
    headerRow.style.fontSize = `${headerFontSize}px`;
    headerRow.style.fontWeight = 'bold';
    headerRow.style.borderBottom = '0.5px solid #000';
    headerRow.style.flexShrink = '0';

    for (const col of columns) {
      const cell = document.createElement('div');
      cell.style.flex = `0 0 ${(col.width / totalWidth) * 100}%`;
      cell.style.padding = '3px 4px';
      cell.style.boxSizing = 'border-box';
      cell.style.overflow = 'hidden';
      cell.style.textOverflow = 'ellipsis';
      cell.style.whiteSpace = 'nowrap';
      cell.style.textAlign = col.align || 'left';
      cell.style.display = 'flex';
      cell.style.alignItems = 'center';

      // Column type indicator
      const colType = col.columnType || 'field';
      if (colType !== 'field') {
        const indicator = createTypeIndicator(colType, '#ffffff');
        indicator.style.display = 'inline-flex';
        cell.appendChild(indicator);
      }

      // Header text
      const headerText = document.createElement('span');
      headerText.textContent = col.header || '(untitled)';
      headerText.style.overflow = 'hidden';
      headerText.style.textOverflow = 'ellipsis';
      cell.appendChild(headerText);

      // Per-column header font override
      if (col.headerColumnStyle) {
        if (col.headerColumnStyle.fontSize) cell.style.fontSize = `${col.headerColumnStyle.fontSize}px`;
        if (col.headerColumnStyle.fontColor) cell.style.color = col.headerColumnStyle.fontColor;
      }

      headerRow.appendChild(cell);
    }
    container.appendChild(headerRow);
    contentHeight += headerFontSize + 8; // approximate header height
  }

  // ─── Body rows ──────────────────────────────────────────────────
  const dataRowCount = bodyRows.length;
  for (let ri = 0; ri < dataRowCount; ri++) {
    const row = bodyRows[ri];
    const rowDiv = document.createElement('div');
    rowDiv.style.display = 'flex';
    rowDiv.style.fontSize = `${bodyFontSize}px`;
    rowDiv.style.borderBottom = '0.25px solid #cccccc';
    rowDiv.style.flexShrink = '0';

    if (alternateRowShading && ri % 2 === 1) {
      rowDiv.style.backgroundColor = alternateRowColor;
    }

    let maxCellLines = 1;
    for (let ci = 0; ci < columns.length; ci++) {
      const col = columns[ci];
      const cell = document.createElement('div');
      cell.style.flex = `0 0 ${(col.width / totalWidth) * 100}%`;
      cell.style.padding = '2px 4px';
      cell.style.boxSizing = 'border-box';
      cell.style.textAlign = col.align || 'left';

      // Overflow behaviour per column (default: wrap)
      const overflow = (col as any).overflow || 'wrap';
      if (overflow === 'wrap') {
        cell.style.whiteSpace = 'normal';
        cell.style.wordBreak = 'break-word';
        cell.style.overflow = 'hidden';
        // Estimate wrapped line count for row height tracking
        const text = row[ci] || '';
        const charWidth = bodyFontSize * 0.55; // approximate avg char width in px
        const colWidthPx = ((col.width / totalWidth) * rootElement.clientWidth) || 50;
        const charsPerLine = Math.max(1, Math.floor((colWidthPx - 8) / charWidth));
        const lineCount = Math.ceil(text.length / charsPerLine) || 1;
        if (lineCount > maxCellLines) maxCellLines = lineCount;
      } else {
        // clip / truncate: single line
        cell.style.overflow = 'hidden';
        cell.style.textOverflow = overflow === 'truncate' ? 'ellipsis' : 'clip';
        cell.style.whiteSpace = 'nowrap';
      }

      cell.textContent = row[ci] || '';

      // Per-column body font overrides
      if (col.columnStyle) {
        if (col.columnStyle.fontSize) cell.style.fontSize = `${col.columnStyle.fontSize}px`;
        if (col.columnStyle.fontColor) cell.style.color = col.columnStyle.fontColor;
        if (col.columnStyle.bold) cell.style.fontWeight = 'bold';
        if (col.columnStyle.italic) cell.style.fontStyle = 'italic';
      }

      rowDiv.appendChild(cell);
    }
    container.appendChild(rowDiv);
    contentHeight += (bodyFontSize + 6) * maxCellLines;
  }

  // ─── Tracking sub-rows (sample) ──────────────────────────────────
  if (showTrackingDetails && isUsingPlaceholders && columns.length > 0) {
    const trackingFontSize = (trackingDetailStyle.fontSize as number) || 7;
    const trackingBg = (trackingDetailStyle.backgroundColor as string) || '#f9fafb';
    const trackingColor = (trackingDetailStyle.fontColor as string) || '#6b7280';
    const indent = (trackingDetailStyle.indent as number) || 4;
    const indentStr = ' '.repeat(indent) + '↳ ';

    // Show 2 sample serial sub-rows after first data row
    const sampleTrackingTexts = [
      `${indentStr}S/N: Serial No: SN-001 | Status: Active`,
      `${indentStr}S/N: Serial No: SN-002 | Status: Active`,
    ];

    for (const text of sampleTrackingTexts) {
      const trackRow = document.createElement('div');
      trackRow.style.display = 'flex';
      trackRow.style.fontSize = `${trackingFontSize}px`;
      trackRow.style.borderBottom = '0.25px solid #e5e7eb';
      trackRow.style.backgroundColor = trackingBg;
      trackRow.style.color = trackingColor;
      trackRow.style.flexShrink = '0';

      const cell = document.createElement('div');
      cell.style.flex = '1';
      cell.style.padding = '1px 4px';
      cell.style.overflow = 'hidden';
      cell.style.textOverflow = 'ellipsis';
      cell.style.whiteSpace = 'nowrap';
      cell.textContent = text;
      trackRow.appendChild(cell);

      container.appendChild(trackRow);
      contentHeight += trackingFontSize + 4;
    }
  }

  // ─── Footer rows ────────────────────────────────────────────────
  if (footerRows.length > 0 && columns.length > 0) {
    for (const footer of footerRows) {
      const footerDiv = document.createElement('div');
      footerDiv.style.display = 'flex';
      footerDiv.style.fontSize = `${bodyFontSize}px`;
      footerDiv.style.flexShrink = '0';

      // Footer styling
      if (footer.style?.fontWeight === 'bold') {
        footerDiv.style.fontWeight = 'bold';
      }
      if (footer.style?.borderBottom) {
        footerDiv.style.borderBottom = footer.style.borderBottom;
      } else {
        footerDiv.style.borderBottom = '0.5px solid #999';
      }
      if (footer.style?.fontSize) {
        footerDiv.style.fontSize = `${footer.style.fontSize}px`;
      }

      // Top border for first footer row to separate from body
      if (footer === footerRows[0]) {
        footerDiv.style.borderTop = '1px solid #333';
      }

      const labelColKey = footer.labelColumnKey || (columns.length > 0 ? columns[0].key : '');
      const labelColSpan = footer.labelColSpan || 1;

      for (let ci = 0; ci < columns.length; ci++) {
        const col = columns[ci];
        const cell = document.createElement('div');
        cell.style.flex = `0 0 ${(col.width / totalWidth) * 100}%`;
        cell.style.padding = '2px 4px';
        cell.style.boxSizing = 'border-box';
        cell.style.overflow = 'hidden';
        cell.style.textOverflow = 'ellipsis';
        cell.style.whiteSpace = 'nowrap';
        cell.style.textAlign = col.align || 'left';

        if (col.key === labelColKey) {
          cell.textContent = footer.label;
          cell.style.fontWeight = 'bold';
          // Apply colSpan by extending width
          if (labelColSpan > 1) {
            let spanWidth = 0;
            for (let s = ci; s < Math.min(ci + labelColSpan, columns.length); s++) {
              spanWidth += columns[s].width;
            }
            cell.style.flex = `0 0 ${(spanWidth / totalWidth) * 100}%`;
          }
        } else if (col.key === footer.valueColumnKey) {
          // Show sample footer value
          switch (footer.type) {
            case 'sum':
              cell.textContent = '925.00';
              break;
            case 'percentage':
              cell.textContent = '138.75';
              break;
            case 'sumWithFooters':
              cell.textContent = '1,063.75';
              break;
            default:
              cell.textContent = '0.00';
          }
          cell.style.textAlign = 'right';
        } else {
          cell.textContent = '';
        }

        footerDiv.appendChild(cell);
      }

      container.appendChild(footerDiv);
      contentHeight += (footer.style?.fontSize || bodyFontSize) + 6;
    }
  }

  // ─── Empty state ────────────────────────────────────────────────
  if (columns.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.style.display = 'flex';
    emptyDiv.style.alignItems = 'center';
    emptyDiv.style.justifyContent = 'center';
    emptyDiv.style.height = '100%';
    emptyDiv.style.color = '#9ca3af';
    emptyDiv.style.fontSize = '10px';
    emptyDiv.style.fontStyle = 'italic';
    emptyDiv.textContent = 'Line Items Table — configure columns in properties panel';
    container.appendChild(emptyDiv);
  }

  // ─── Overflow indicator ─────────────────────────────────────────
  const elementHeight = (schema.height as number) || 100;
  // Approximate: contentHeight is in px, elementHeight is in mm (1mm ≈ 3.78px at 96dpi)
  const elementHeightPx = elementHeight * 3.78;
  if (contentHeight > elementHeightPx * 0.9) {
    const overflowIndicator = document.createElement('div');
    overflowIndicator.style.position = 'absolute';
    overflowIndicator.style.bottom = '0';
    overflowIndicator.style.left = '0';
    overflowIndicator.style.right = '0';
    overflowIndicator.style.height = '12px';
    overflowIndicator.style.background = 'linear-gradient(transparent, rgba(200, 200, 200, 0.5))';
    overflowIndicator.style.pointerEvents = 'none';
    overflowIndicator.style.display = 'flex';
    overflowIndicator.style.alignItems = 'flex-end';
    overflowIndicator.style.justifyContent = 'center';

    const overflowText = document.createElement('span');
    overflowText.style.fontSize = '6px';
    overflowText.style.color = '#666';
    overflowText.style.paddingBottom = '1px';
    overflowText.textContent = '···';
    overflowIndicator.appendChild(overflowText);

    container.appendChild(overflowIndicator);
  }

  rootElement.appendChild(container);
}
