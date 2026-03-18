/**
 * Grouped Table schema plugin
 *
 * Hierarchical report layouts with groupBy (up to 3 levels),
 * group header/footer rows with subtotals, multi-level nesting.
 *
 * Features:
 * - #121: Basic groupBy rendering with group headers
 * - #122: Subtotals per group (SUM, COUNT, AVG, MIN, MAX)
 * - #123: Multi-level nesting (up to 3 levels)
 */

export interface GroupedTableColumn {
  key: string;
  header: string;
  width: number; // percentage or mm
  align?: 'left' | 'center' | 'right';
  format?: string; // e.g., '#,##0.00' for numbers
  aggregation?: 'SUM' | 'COUNT' | 'AVG' | 'MIN' | 'MAX';
}

export interface GroupedTableConfig {
  columns: GroupedTableColumn[];
  groupBy: string[]; // Field keys to group by, ordered by nesting level (max 3)
  data: Record<string, unknown>[];
  showGroupHeaders?: boolean; // Default true
  showGroupFooters?: boolean; // Default true
  showGrandTotal?: boolean; // Default true
  groupHeaderStyle?: RowStyleConfig;
  groupFooterStyle?: RowStyleConfig;
  grandTotalStyle?: RowStyleConfig;
  headerStyle?: RowStyleConfig;
  rowStyle?: RowStyleConfig;
  alternateRowShading?: boolean; // Default false
}

export interface RowStyleConfig {
  backgroundColor?: string;
  fontWeight?: 'normal' | 'bold';
  fontSize?: number;
  textColor?: string;
  borderBottom?: string;
  indent?: number; // pixels/mm indentation per nesting level
}

export interface GroupNode {
  key: string; // The group field key
  value: unknown; // The group field value
  level: number; // Nesting level (0-based)
  rows: Record<string, unknown>[]; // Data rows in this group
  children: GroupNode[]; // Sub-groups (next level)
  subtotals: Record<string, number>; // Aggregated values per column key
}

export interface RenderedRow {
  type: 'header' | 'columnHeader' | 'groupHeader' | 'data' | 'groupFooter' | 'grandTotal';
  level?: number; // Nesting level for group rows
  groupKey?: string;
  groupValue?: unknown;
  cells: RenderedCell[];
  style?: RowStyleConfig;
}

export interface RenderedCell {
  columnKey: string;
  value: string;
  align?: 'left' | 'center' | 'right';
  colSpan?: number;
}

/**
 * GroupedTable - Processes tabular data into a hierarchical grouped layout
 * suitable for rendering in reports (aged debtors, sales analysis, stock, etc.)
 */
export class GroupedTable {
  private config: GroupedTableConfig;

  constructor(config: GroupedTableConfig) {
    if (!config.groupBy || config.groupBy.length === 0) {
      throw new Error('groupBy must contain at least one field');
    }
    if (config.groupBy.length > 3) {
      throw new Error('Maximum 3 levels of grouping supported');
    }
    this.config = {
      ...config,
      showGroupHeaders: config.showGroupHeaders !== false,
      showGroupFooters: config.showGroupFooters !== false,
      showGrandTotal: config.showGrandTotal !== false,
      alternateRowShading: config.alternateRowShading === true,
    };
  }

  /**
   * Build the hierarchical group tree from flat data.
   */
  buildGroupTree(data?: Record<string, unknown>[]): GroupNode[] {
    const rows = data || this.config.data;
    return this.groupRecursive(rows, 0);
  }

  /**
   * Recursively group data by the groupBy fields at the specified level.
   */
  private groupRecursive(rows: Record<string, unknown>[], level: number): GroupNode[] {
    if (level >= this.config.groupBy.length) {
      return [];
    }

    const groupField = this.config.groupBy[level];
    const groups = new Map<string, Record<string, unknown>[]>();
    const groupOrder: string[] = [];

    for (const row of rows) {
      const value = this.getNestedValue(row, groupField);
      const key = String(value ?? '(blank)');
      if (!groups.has(key)) {
        groups.set(key, []);
        groupOrder.push(key);
      }
      groups.get(key)!.push(row);
    }

    return groupOrder.map((key) => {
      const groupRows = groups.get(key)!;
      const children = this.groupRecursive(groupRows, level + 1);
      const subtotals = this.calculateSubtotals(groupRows);

      return {
        key: groupField,
        value: key === '(blank)' ? null : key,
        level,
        rows: groupRows,
        children,
        subtotals,
      };
    });
  }

  /**
   * Calculate subtotals (aggregations) for a set of rows.
   */
  calculateSubtotals(rows: Record<string, unknown>[]): Record<string, number> {
    const subtotals: Record<string, number> = {};

    for (const col of this.config.columns) {
      if (!col.aggregation) continue;

      const values = rows
        .map((row) => {
          const v = this.getNestedValue(row, col.key);
          return typeof v === 'number' ? v : parseFloat(String(v));
        })
        .filter((v) => !isNaN(v));

      switch (col.aggregation) {
        case 'SUM':
          subtotals[col.key] = values.reduce((sum, v) => sum + v, 0);
          break;
        case 'COUNT':
          subtotals[col.key] = values.length;
          break;
        case 'AVG':
          subtotals[col.key] = values.length > 0
            ? values.reduce((sum, v) => sum + v, 0) / values.length
            : 0;
          break;
        case 'MIN':
          subtotals[col.key] = values.length > 0 ? Math.min(...values) : 0;
          break;
        case 'MAX':
          subtotals[col.key] = values.length > 0 ? Math.max(...values) : 0;
          break;
      }
    }

    return subtotals;
  }

  /**
   * Render the grouped table into a flat list of RenderedRows.
   * This is the main output method - produces rows that can be drawn into a PDF.
   */
  render(): RenderedRow[] {
    const rows: RenderedRow[] = [];
    const tree = this.buildGroupTree();

    // Column header row
    rows.push({
      type: 'columnHeader',
      cells: this.config.columns.map((col) => ({
        columnKey: col.key,
        value: col.header,
        align: col.align || 'left',
      })),
      style: this.config.headerStyle || { fontWeight: 'bold', borderBottom: '1px solid #000' },
    });

    // Render each top-level group
    for (const group of tree) {
      this.renderGroup(group, rows);
    }

    // Grand total row
    if (this.config.showGrandTotal) {
      const grandTotals = this.calculateSubtotals(this.config.data);
      const hasAggregations = this.config.columns.some((c) => c.aggregation);
      if (hasAggregations) {
        rows.push({
          type: 'grandTotal',
          cells: this.config.columns.map((col, i) => {
            if (i === 0 && !col.aggregation) {
              return {
                columnKey: col.key,
                value: 'Grand Total',
                align: 'left' as const,
              };
            }
            if (col.aggregation) {
              return {
                columnKey: col.key,
                value: this.formatValue(grandTotals[col.key], col),
                align: col.align || 'right',
              };
            }
            return {
              columnKey: col.key,
              value: '',
              align: col.align || 'left',
            };
          }),
          style: this.config.grandTotalStyle || {
            fontWeight: 'bold',
            borderBottom: '2px solid #000',
            backgroundColor: '#e0e0e0',
          },
        });
      }
    }

    return rows;
  }

  /**
   * Render a single group node and its children recursively.
   */
  private renderGroup(group: GroupNode, rows: RenderedRow[]): void {
    // Group header
    if (this.config.showGroupHeaders) {
      rows.push({
        type: 'groupHeader',
        level: group.level,
        groupKey: group.key,
        groupValue: group.value,
        cells: [{
          columnKey: '__group__',
          value: `${group.value ?? '(blank)'}`,
          align: 'left',
          colSpan: this.config.columns.length,
        }],
        style: {
          fontWeight: 'bold',
          backgroundColor: this.getGroupHeaderColor(group.level),
          ...(this.config.groupHeaderStyle || {}),
        },
      });
    }

    // If this group has children (sub-groups), render them
    if (group.children.length > 0) {
      for (const child of group.children) {
        this.renderGroup(child, rows);
      }
    } else {
      // Leaf level - render data rows
      let rowIndex = 0;
      for (const dataRow of group.rows) {
        const bgColor = this.config.alternateRowShading && rowIndex % 2 === 1
          ? '#f9f9f9'
          : undefined;

        rows.push({
          type: 'data',
          level: group.level,
          cells: this.config.columns.map((col) => ({
            columnKey: col.key,
            value: this.formatValue(this.getNestedValue(dataRow, col.key), col),
            align: col.align || 'left',
          })),
          style: {
            ...(this.config.rowStyle || {}),
            ...(bgColor ? { backgroundColor: bgColor } : {}),
          },
        });
        rowIndex++;
      }
    }

    // Group footer with subtotals
    if (this.config.showGroupFooters) {
      const hasAggregations = this.config.columns.some((c) => c.aggregation);
      if (hasAggregations) {
        rows.push({
          type: 'groupFooter',
          level: group.level,
          groupKey: group.key,
          groupValue: group.value,
          cells: this.config.columns.map((col, i) => {
            if (i === 0 && !col.aggregation) {
              return {
                columnKey: col.key,
                value: `Subtotal: ${group.value ?? '(blank)'}`,
                align: 'left' as const,
              };
            }
            if (col.aggregation) {
              return {
                columnKey: col.key,
                value: this.formatValue(group.subtotals[col.key], col),
                align: col.align || 'right',
              };
            }
            return {
              columnKey: col.key,
              value: '',
              align: col.align || 'left',
            };
          }),
          style: {
            fontWeight: 'bold',
            borderBottom: '1px solid #999',
            ...(this.config.groupFooterStyle || {}),
          },
        });
      }
    }
  }

  /**
   * Get a color for group headers based on nesting level.
   */
  private getGroupHeaderColor(level: number): string {
    const colors = ['#d0d0d0', '#e0e0e0', '#f0f0f0'];
    return colors[Math.min(level, colors.length - 1)];
  }

  /**
   * Format a value for display, using column format if specified.
   */
  private formatValue(value: unknown, col: GroupedTableColumn): string {
    if (value === null || value === undefined) return '';

    if (typeof value === 'number' && col.format) {
      return this.formatNumber(value, col.format);
    }

    if (typeof value === 'number') {
      // If the column has aggregation, show 2 decimal places by default
      if (col.aggregation) {
        return value.toFixed(2);
      }
      return String(value);
    }

    return String(value);
  }

  /**
   * Format a number using a pattern like '#,##0.00'.
   */
  private formatNumber(value: number, pattern: string): string {
    const patternParts = pattern.split('.');
    const decPattern = patternParts.length > 1 ? patternParts[1] : '';
    const intPattern = patternParts[0];
    const decimalPlaces = decPattern.length;
    const absValue = Math.abs(value);
    const rounded = decimalPlaces > 0 ? absValue.toFixed(decimalPlaces) : Math.round(absValue).toString();
    const [intPart, decPart] = rounded.split('.');

    let formattedInt = intPart;
    if (intPattern.includes(',')) {
      formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    let result = formattedInt;
    if (decPart !== undefined) {
      result += '.' + decPart;
    }

    if (value < 0) {
      result = '-' + result;
    }

    return result;
  }

  /**
   * Get a nested value from an object using dot notation.
   */
  private getNestedValue(obj: Record<string, unknown>, key: string): unknown {
    const parts = key.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current === 'object' && current !== null) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return current;
  }

  /**
   * Convert the rendered rows to a pdfme-compatible table input structure.
   * This generates the text content for a pdfme table plugin field.
   * Each row must have exactly the same number of cells as columns.
   */
  toPdfmeTableInput(): string[][] {
    const rendered = this.render();
    const colCount = this.config.columns.length;

    return rendered.map((row) => {
      // If the row has a colSpan cell (groupHeader), pad to match column count
      if (row.cells.length === 1 && row.cells[0].colSpan && row.cells[0].colSpan > 1) {
        const result = [row.cells[0].value];
        for (let i = 1; i < colCount; i++) {
          result.push('');
        }
        return result;
      }

      // Standard row - ensure all cells present
      const cells = row.cells.map((cell) => cell.value);
      while (cells.length < colCount) {
        cells.push('');
      }
      return cells;
    });
  }

  /**
   * Get summary statistics about the grouped data.
   */
  getSummary(): {
    totalRows: number;
    groupLevels: number;
    groupCounts: Record<string, number>;
    grandTotals: Record<string, number>;
  } {
    const tree = this.buildGroupTree();
    const grandTotals = this.calculateSubtotals(this.config.data);
    const groupCounts: Record<string, number> = {};

    const countGroups = (nodes: GroupNode[], level: number) => {
      const key = this.config.groupBy[level];
      groupCounts[key] = (groupCounts[key] || 0) + nodes.length;
      for (const node of nodes) {
        if (node.children.length > 0) {
          countGroups(node.children, level + 1);
        }
      }
    };
    countGroups(tree, 0);

    return {
      totalRows: this.config.data.length,
      groupLevels: this.config.groupBy.length,
      groupCounts,
      grandTotals,
    };
  }
}

// Default export for backward compatibility
export const groupedTable = {
  GroupedTable,
};
