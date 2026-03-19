/**
 * Line Items Table - UI renderer for the designer canvas.
 *
 * Renders a visual table preview in the DOM when the element is displayed
 * in the pdfme Designer/Viewer/Form UI. Shows column headers and sample
 * data rows with proper styling.
 */

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
  const { schema, value, rootElement, mode } = arg;
  rootElement.innerHTML = '';

  const columns = (schema.columns as Array<{ key: string; header: string; width: number; align?: string }>) || [];
  const showHeader = schema.showHeader !== false;
  const alternateRowShading = schema.alternateRowShading === true;
  const alternateRowColor = (schema.alternateRowColor as string) || '#f7fafc';
  const headerBg = ((schema.headerStyle as Record<string, unknown>)?.backgroundColor as string) || '#2d3748';
  const bodyFontSize = ((schema.bodyStyle as Record<string, unknown>)?.fontSize as number) || 8;
  const headerFontSize = ((schema.headerStyle as Record<string, unknown>)?.fontSize as number) || 9;

  // Parse body data from value (JSON string of string[][])
  let bodyRows: string[][] = [];
  if (value) {
    try {
      bodyRows = JSON.parse(value);
    } catch {
      bodyRows = [];
    }
  }

  // If no data, show placeholder rows
  if (bodyRows.length === 0) {
    bodyRows = [
      columns.map((col) => col.key === 'description' ? 'Sample Item 1' : col.key === 'qty' ? '2' : col.key === 'unitPrice' ? '100.00' : col.key === 'amount' ? '200.00' : '...'),
      columns.map((col) => col.key === 'description' ? 'Sample Item 2' : col.key === 'qty' ? '1' : col.key === 'unitPrice' ? '50.00' : col.key === 'amount' ? '50.00' : '...'),
    ];
  }

  // Container
  const container = document.createElement('div');
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.overflow = 'hidden';
  container.style.fontFamily = 'Arial, sans-serif';
  container.style.boxSizing = 'border-box';
  container.style.border = '0.5px solid #000';

  // Calculate total width for proportional column sizing
  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0) || 1;

  // Header row
  if (showHeader && columns.length > 0) {
    const headerRow = document.createElement('div');
    headerRow.style.display = 'flex';
    headerRow.style.backgroundColor = headerBg;
    headerRow.style.color = '#ffffff';
    headerRow.style.fontSize = `${headerFontSize}px`;
    headerRow.style.fontWeight = 'bold';
    headerRow.style.borderBottom = '0.5px solid #000';

    for (const col of columns) {
      const cell = document.createElement('div');
      cell.style.flex = `0 0 ${(col.width / totalWidth) * 100}%`;
      cell.style.padding = '3px 4px';
      cell.style.boxSizing = 'border-box';
      cell.style.overflow = 'hidden';
      cell.style.textOverflow = 'ellipsis';
      cell.style.whiteSpace = 'nowrap';
      cell.style.textAlign = col.align || 'left';
      cell.textContent = col.header;
      headerRow.appendChild(cell);
    }
    container.appendChild(headerRow);
  }

  // Body rows
  for (let ri = 0; ri < bodyRows.length; ri++) {
    const row = bodyRows[ri];
    const rowDiv = document.createElement('div');
    rowDiv.style.display = 'flex';
    rowDiv.style.fontSize = `${bodyFontSize}px`;
    rowDiv.style.borderBottom = '0.25px solid #cccccc';

    if (alternateRowShading && ri % 2 === 1) {
      rowDiv.style.backgroundColor = alternateRowColor;
    }

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
      cell.textContent = row[ci] || '';
      rowDiv.appendChild(cell);
    }
    container.appendChild(rowDiv);
  }

  rootElement.appendChild(container);
}
