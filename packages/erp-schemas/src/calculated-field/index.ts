/**
 * Calculated Field schema plugin
 *
 * Expression-evaluated field with format string, evaluated at render time.
 * Uses the ExpressionEngine for evaluation and formatting.
 *
 * At render time, the calculatedField is resolved to a text element:
 * 1. Expression is evaluated against input data context
 * 2. Result is formatted using the format pattern (if provided)
 * 3. The field is converted to a pdfme text element with the formatted value
 *
 * Schema properties:
 * - type: 'calculatedField'
 * - expression: string (e.g., 'field.qty * field.unitPrice')
 * - format: string (e.g., '#,##0.00' for numbers, 'yyyy-MM-dd' for dates)
 * - fontSize: number (default: 12)
 * - fontName: string (default: 'Helvetica')
 * - alignment: 'left' | 'center' | 'right' (default: 'left')
 * - fontColor: string (default: '#000000')
 */

import { ExpressionEngine, ExpressionEngineOptions } from '../expression-engine';

export interface CalculatedFieldSchema {
  type: 'calculatedField';
  name: string;
  expression: string;
  format?: string;
  fontSize?: number;
  fontName?: string;
  alignment?: 'left' | 'center' | 'right';
  fontColor?: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  [key: string]: unknown;
}

export interface ResolvedCalculatedField {
  name: string;
  value: string;
  rawValue: unknown;
}

/**
 * Evaluate a calculated field expression and format the result.
 *
 * @param expression - The expression to evaluate (e.g., 'field.qty * field.unitPrice')
 * @param context - Data context with field values
 * @param format - Optional format pattern (e.g., '#,##0.00')
 * @param engineOptions - Optional ExpressionEngine options (locale, currency)
 * @returns Formatted string result
 */
export function evaluateCalculatedField(
  expression: string,
  context: Record<string, unknown>,
  format?: string,
  engineOptions?: ExpressionEngineOptions,
): string {
  const engine = new ExpressionEngine(engineOptions);

  try {
    // If format is provided, wrap the expression in a FORMAT() call
    if (format) {
      const formatExpr = `FORMAT(${expression}, '${format}')`;
      try {
        const result = engine.evaluate(formatExpr, context);
        return String(result);
      } catch {
        // If FORMAT wrapping fails, evaluate raw and format manually
        const rawResult = engine.evaluate(expression, context);
        if (typeof rawResult === 'number') {
          return formatNumber(rawResult, format);
        }
        return String(rawResult);
      }
    }

    const result = engine.evaluate(expression, context);
    return String(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `#ERR: ${message}`;
  }
}

/**
 * Simple number formatting with pattern support.
 * Patterns: #,##0.00, #,##0, 0.00, etc.
 */
function formatNumber(value: number, pattern: string): string {
  // Determine decimal places from pattern
  const decimalIndex = pattern.indexOf('.');
  let decimals = 0;
  if (decimalIndex !== -1) {
    decimals = pattern.length - decimalIndex - 1;
  }

  // Check for grouping separator
  const hasGrouping = pattern.includes(',');

  let formatted = value.toFixed(decimals);

  if (hasGrouping) {
    const parts = formatted.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    formatted = parts.join('.');
  }

  return formatted;
}

/**
 * Resolve all calculatedField elements in a template.
 * Evaluates expressions against input data and converts to text elements.
 *
 * @param template - The pdfme template with schemas
 * @param inputs - Array of input records
 * @param engineOptions - Optional ExpressionEngine options
 * @returns Modified template and inputs with calculated fields resolved to text
 */
export function resolveCalculatedFields(
  template: { basePdf: unknown; schemas: unknown[] },
  inputs: Record<string, string>[],
  engineOptions?: ExpressionEngineOptions,
): { template: { basePdf: unknown; schemas: unknown[] }; inputs: Record<string, string>[] } {
  if (!Array.isArray(template.schemas)) return { template, inputs };

  // Build a context from the first input record for expression evaluation
  const context: Record<string, unknown> = {};
  if (inputs.length > 0) {
    for (const [key, value] of Object.entries(inputs[0])) {
      // Try to parse numeric values
      const num = Number(value);
      context[key] = isNaN(num) || value === '' ? value : num;
    }
  }

  // Also support nested field references (field.qty format)
  // The ExpressionEngine handles dot notation internally

  const resolvedFields: ResolvedCalculatedField[] = [];

  const newSchemas = template.schemas.map((page: unknown) => {
    if (!Array.isArray(page)) return page;
    return page.map((field: unknown) => {
      if (
        !field ||
        typeof field !== 'object' ||
        !('type' in field) ||
        (field as { type: string }).type !== 'calculatedField'
      ) {
        return field;
      }

      const calcField = field as CalculatedFieldSchema;
      const expression = calcField.expression || '0';
      const format = calcField.format;

      // Evaluate the expression
      const formattedValue = evaluateCalculatedField(expression, context, format, engineOptions);

      resolvedFields.push({
        name: calcField.name,
        value: formattedValue,
        rawValue: formattedValue,
      });

      // Convert to a text element
      return {
        name: calcField.name,
        type: 'text',
        position: calcField.position,
        width: calcField.width,
        height: calcField.height,
        fontSize: calcField.fontSize || 12,
        fontName: calcField.fontName || undefined,
        alignment: calcField.alignment || 'left',
        fontColor: calcField.fontColor || '#000000',
      };
    });
  });

  // Update inputs with calculated values
  const newInputs = inputs.map((input) => {
    const updated = { ...input };
    for (const resolved of resolvedFields) {
      updated[resolved.name] = resolved.value;
    }
    return updated;
  });

  return {
    template: { basePdf: template.basePdf, schemas: newSchemas },
    inputs: newInputs,
  };
}

/**
 * The calculatedField plugin definition.
 */
export const calculatedField = {
  type: 'calculatedField' as const,

  defaultSchema: {
    type: 'calculatedField',
    expression: '0',
    format: '#,##0.00',
    fontSize: 12,
    alignment: 'left',
    fontColor: '#000000',
    position: { x: 0, y: 0 },
    width: 50,
    height: 15,
  },

  evaluateCalculatedField,
  resolveCalculatedFields,
};
