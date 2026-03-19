/**
 * Grouped Table - UI renderer for the designer canvas.
 *
 * Renders a visual grouped table preview in the DOM when the element is
 * displayed in the pdfme Designer/Viewer/Form UI. Shows column headers,
 * group headers, data rows, and footer rows with proper styling.
 */

import type { GroupedTableColumn, RowStyleConfig } from './index';

/**
 * Render a grouped table preview into the given root element.
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

  const columns = (schema.columns as GroupedTableColumn[]) || [];
  const groupBy = (schema.groupBy as string[]) || [];
  const showGroupHeaders = schema.showGroupHeaders !== false;
  const showGroupFooters = schema.showGroupFooters !== false;
  const showGrandTotal = schema.showGrandTotal !== false;
  const headerStyle = (schema.headerStyle as RowStyleConfig) || {};
  const groupHeaderStyle = (schema.groupHeaderStyle as RowStyleConfig) || {};

  // Parse value data (JSON array of row arrays)
  let bodyRows: string[][] = [];
  if (value) {
    try {
      bodyRows = JSON.parse(value);
    } catch {
      bodyRows = [];
    }
  }

  // Container
  const container = document.createElement('div');
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.overflow = 'hidden';
  container.style.fontFamily = 'Arial, sans-serif';
  container.style.boxSizing = 'border-box';
  container.style.border = '0.5px solid #000';
  container.style.fontSize = '8px';

  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0) || 1;

  // Column header row
  const headerRow = document.createElement('div');
  headerRow.style.display = 'flex';
  headerRow.style.backgroundColor = headerStyle.backgroundColor || '#e0e0e0';
  headerRow.style.fontWeight = headerStyle.fontWeight || 'bold';
  headerRow.style.fontSize = `${headerStyle.fontSize || 9}px`;
  headerRow.style.borderBottom = headerStyle.borderBottom || '1px solid #000';

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

  // If we have body data, render it
  if (bodyRows.length > 0) {
    for (const row of bodyRows) {
      const rowDiv = document.createElement('div');
      rowDiv.style.display = 'flex';
      rowDiv.style.borderBottom = '0.25px solid #cccccc';

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
  } else {
    // Show placeholder preview with sample grouped data
    const groupField = groupBy[0] || 'group';

    // Group header
    if (showGroupHeaders) {
      const ghRow = document.createElement('div');
      ghRow.style.display = 'flex';
      ghRow.style.backgroundColor = groupHeaderStyle.backgroundColor || '#d0d0d0';
      ghRow.style.fontWeight = 'bold';
      ghRow.style.borderBottom = '0.5px solid #999';
      const ghCell = document.createElement('div');
      ghCell.style.flex = '1';
      ghCell.style.padding = '3px 4px';
      ghCell.textContent = `Group A (${groupField})`;
      ghRow.appendChild(ghCell);
      container.appendChild(ghRow);
    }

    // Sample data rows
    for (let i = 0; i < 3; i++) {
      const rowDiv = document.createElement('div');
      rowDiv.style.display = 'flex';
      rowDiv.style.borderBottom = '0.25px solid #cccccc';

      for (let ci = 0; ci < columns.length; ci++) {
        const col = columns[ci];
        const cell = document.createElement('div');
        cell.style.flex = `0 0 ${(col.width / totalWidth) * 100}%`;
        cell.style.padding = '2px 4px';
        cell.style.boxSizing = 'border-box';
        cell.style.textAlign = col.align || 'left';
        cell.textContent = col.aggregation ? `${(100 + i * 50).toFixed(2)}` : `Row ${i + 1}`;
        rowDiv.appendChild(cell);
      }
      container.appendChild(rowDiv);
    }

    // Group footer
    if (showGroupFooters) {
      const gfRow = document.createElement('div');
      gfRow.style.display = 'flex';
      gfRow.style.fontWeight = 'bold';
      gfRow.style.borderBottom = '1px solid #999';
      gfRow.style.backgroundColor = '#f0f0f0';

      for (let ci = 0; ci < columns.length; ci++) {
        const col = columns[ci];
        const cell = document.createElement('div');
        cell.style.flex = `0 0 ${(col.width / totalWidth) * 100}%`;
        cell.style.padding = '2px 4px';
        cell.style.boxSizing = 'border-box';
        cell.style.textAlign = col.align || 'left';
        if (ci === 0) {
          cell.textContent = 'Subtotal: Group A';
        } else if (col.aggregation) {
          cell.textContent = '300.00';
        }
        gfRow.appendChild(cell);
      }
      container.appendChild(gfRow);
    }

    // Grand total
    if (showGrandTotal) {
      const gtRow = document.createElement('div');
      gtRow.style.display = 'flex';
      gtRow.style.fontWeight = 'bold';
      gtRow.style.borderTop = '2px solid #000';
      gtRow.style.backgroundColor = '#e0e0e0';

      for (let ci = 0; ci < columns.length; ci++) {
        const col = columns[ci];
        const cell = document.createElement('div');
        cell.style.flex = `0 0 ${(col.width / totalWidth) * 100}%`;
        cell.style.padding = '3px 4px';
        cell.style.boxSizing = 'border-box';
        cell.style.textAlign = col.align || 'left';
        if (ci === 0) {
          cell.textContent = 'Grand Total';
        } else if (col.aggregation) {
          cell.textContent = '300.00';
        }
        gtRow.appendChild(cell);
      }
      container.appendChild(gtRow);
    }
  }

  rootElement.appendChild(container);
}
