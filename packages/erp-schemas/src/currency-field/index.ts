/**
 * Currency Field schema plugin
 *
 * Displays monetary values with proper currency symbol, formatting, and
 * optional dual-currency display for multi-currency documents.
 *
 * At render time, the currencyField is resolved to a text element:
 * 1. The value is formatted using the locale/currency configuration
 * 2. Currency symbol is placed according to position config (before/after)
 * 3. If dualCurrency is configured, a second currency line is shown
 *
 * Schema properties:
 * - type: 'currencyField'
 * - name: string (field name for input binding)
 * - currencyCode: string (ISO 4217 code, e.g. 'USD', 'ZAR', 'EUR')
 * - currencySymbol: string (e.g. '$', 'R', '€') — overrides locale default
 * - symbolPosition: 'before' | 'after' (default: 'before')
 * - thousandSeparator: string (default from locale)
 * - decimalSeparator: string (default from locale)
 * - decimalPlaces: number (default: 2)
 * - dualCurrency: optional dual-currency display config
 *   - enabled: boolean
 *   - targetCurrencyCode: string (ISO 4217)
 *   - targetCurrencySymbol: string
 *   - exchangeRate: number (or field binding like '{{field.exchangeRate}}')
 *   - format: 'below' | 'inline' (default: 'below')
 * - fontSize, fontName, alignment, fontColor: standard text styling
 */

import type { LocaleConfig } from '../types';

export interface DualCurrencyConfig {
  enabled: boolean;
  targetCurrencyCode: string;
  targetCurrencySymbol?: string;
  exchangeRate: number | string; // number or field binding like '{{field.exchangeRate}}'
  format?: 'below' | 'inline'; // default: 'below'
  symbolPosition?: 'before' | 'after';
  decimalPlaces?: number;
}

export interface CurrencyFieldSchema {
  type: 'currencyField';
  name: string;
  currencyCode?: string; // ISO 4217, defaults to locale currency
  currencySymbol?: string; // Overrides resolved symbol
  symbolPosition?: 'before' | 'after';
  thousandSeparator?: string;
  decimalSeparator?: string;
  decimalPlaces?: number; // default: 2
  showCurrencyCode?: boolean; // Show "USD" instead of "$"
  dualCurrency?: DualCurrencyConfig;
  fontSize?: number;
  fontName?: string;
  alignment?: 'left' | 'center' | 'right';
  fontColor?: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  [key: string]: unknown;
}

export interface FormattedCurrencyResult {
  name: string;
  formattedValue: string;
  rawValue: number;
  currencyCode: string;
  currencySymbol: string;
  dualCurrencyValue?: string;
  dualCurrencyRaw?: number;
}

// Default currency symbols for common ISO 4217 codes
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  ZAR: 'R',
  JPY: '¥',
  CNY: '¥',
  AUD: 'A$',
  CAD: 'C$',
  CHF: 'CHF',
  INR: '₹',
  BRL: 'R$',
  KRW: '₩',
  MXN: 'MX$',
  SGD: 'S$',
  HKD: 'HK$',
  NOK: 'kr',
  SEK: 'kr',
  DKK: 'kr',
  NZD: 'NZ$',
  PLN: 'zł',
  THB: '฿',
  TRY: '₺',
  RUB: '₽',
  ILS: '₪',
  MYR: 'RM',
  PHP: '₱',
  TWD: 'NT$',
  AED: 'د.إ',
  SAR: '﷼',
  NGN: '₦',
  KES: 'KSh',
  BWP: 'P',
  NAD: 'N$',
};

/**
 * Resolve the currency symbol for a given currency code.
 */
export function resolveCurrencySymbol(
  currencyCode: string,
  customSymbol?: string,
): string {
  if (customSymbol) return customSymbol;
  return CURRENCY_SYMBOLS[currencyCode.toUpperCase()] || currencyCode;
}

/**
 * Format a numeric value as a currency string.
 */
export function formatCurrencyValue(
  value: number,
  options: {
    currencySymbol: string;
    symbolPosition: 'before' | 'after';
    thousandSeparator: string;
    decimalSeparator: string;
    decimalPlaces: number;
    showCurrencyCode?: boolean;
    currencyCode?: string;
  },
): string {
  const absValue = Math.abs(value);
  const isNegative = value < 0;

  // Format the number
  const fixed = absValue.toFixed(options.decimalPlaces);
  const [intPart, decPart] = fixed.split('.');

  // Apply thousand separator
  let formattedInt = intPart;
  if (options.thousandSeparator) {
    formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, options.thousandSeparator);
  }

  // Build number string
  let numberStr = formattedInt;
  if (options.decimalPlaces > 0 && decPart !== undefined) {
    numberStr += options.decimalSeparator + decPart;
  }

  if (isNegative) {
    numberStr = '-' + numberStr;
  }

  // Apply currency indicator
  const indicator = options.showCurrencyCode && options.currencyCode
    ? options.currencyCode
    : options.currencySymbol;

  if (options.symbolPosition === 'after') {
    return numberStr + ' ' + indicator;
  }
  return indicator + numberStr;
}

/**
 * Resolve a field binding value like '{{field.exchangeRate}}' from context.
 */
function resolveBindingValue(
  value: number | string,
  context: Record<string, unknown>,
): number {
  if (typeof value === 'number') return value;

  // Check if it's a field binding like '{{field.exchangeRate}}'
  const bindingMatch = String(value).match(/^\{\{(.+?)\}\}$/);
  if (bindingMatch) {
    const fieldKey = bindingMatch[1].trim();
    const resolved = resolveNestedField(fieldKey, context);
    const num = Number(resolved);
    if (isNaN(num)) {
      throw new Error(`Exchange rate binding '${fieldKey}' resolved to non-numeric value: ${resolved}`);
    }
    return num;
  }

  // Try parsing as a number
  const num = Number(value);
  if (isNaN(num)) {
    throw new Error(`Invalid exchange rate value: ${value}`);
  }
  return num;
}

/**
 * Resolve a nested field reference like 'field.exchangeRate' from context.
 */
function resolveNestedField(fieldPath: string, context: Record<string, unknown>): unknown {
  // Try direct lookup first
  if (fieldPath in context) return context[fieldPath];

  // Try dot-notation traversal
  const parts = fieldPath.split('.');
  let current: unknown = context;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Format a currency field with optional dual-currency display.
 *
 * @param value - The numeric value to format
 * @param schema - The currency field schema configuration
 * @param locale - Optional locale configuration (from org settings)
 * @param context - Data context for resolving field bindings (e.g., exchange rate)
 * @returns Formatted currency result
 */
export function formatCurrencyField(
  value: number,
  schema: CurrencyFieldSchema,
  locale?: LocaleConfig,
  context?: Record<string, unknown>,
): FormattedCurrencyResult {
  // Resolve currency settings (schema overrides > locale > defaults)
  const currencyCode = schema.currencyCode || locale?.currency?.code || 'USD';
  const currencySymbol = resolveCurrencySymbol(
    currencyCode,
    schema.currencySymbol || (locale?.currency?.code === currencyCode ? locale?.currency?.symbol : undefined),
  );
  const symbolPosition = schema.symbolPosition || locale?.currency?.position || 'before';
  const thousandSeparator = schema.thousandSeparator ?? locale?.currency?.thousandSeparator ?? ',';
  const decimalSeparator = schema.decimalSeparator ?? locale?.currency?.decimalSeparator ?? '.';
  const decimalPlaces = schema.decimalPlaces ?? locale?.currency?.decimalPlaces ?? 2;

  // Format the primary currency value
  const formattedValue = formatCurrencyValue(value, {
    currencySymbol,
    symbolPosition,
    thousandSeparator,
    decimalSeparator,
    decimalPlaces,
    showCurrencyCode: schema.showCurrencyCode,
    currencyCode,
  });

  const result: FormattedCurrencyResult = {
    name: schema.name,
    formattedValue,
    rawValue: value,
    currencyCode,
    currencySymbol,
  };

  // Handle dual-currency display
  if (schema.dualCurrency?.enabled && context) {
    try {
      const exchangeRate = resolveBindingValue(
        schema.dualCurrency.exchangeRate,
        context,
      );

      if (exchangeRate > 0) {
        const convertedValue = value * exchangeRate;
        const targetCode = schema.dualCurrency.targetCurrencyCode;
        const targetSymbol = resolveCurrencySymbol(
          targetCode,
          schema.dualCurrency.targetCurrencySymbol,
        );
        const targetPosition = schema.dualCurrency.symbolPosition || symbolPosition;
        const targetDecimals = schema.dualCurrency.decimalPlaces ?? decimalPlaces;

        const dualFormatted = formatCurrencyValue(convertedValue, {
          currencySymbol: targetSymbol,
          symbolPosition: targetPosition,
          thousandSeparator,
          decimalSeparator,
          decimalPlaces: targetDecimals,
        });

        result.dualCurrencyValue = dualFormatted;
        result.dualCurrencyRaw = convertedValue;

        // Combine primary and dual values
        const displayFormat = schema.dualCurrency.format || 'below';
        if (displayFormat === 'inline') {
          result.formattedValue = `${formattedValue} (${dualFormatted})`;
        } else {
          // 'below' format: primary value on first line, dual on second
          result.formattedValue = `${formattedValue}\n${dualFormatted}`;
        }
      }
    } catch (err) {
      // If exchange rate resolution fails, just show the primary value
      console.warn(`Dual currency resolution failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

/**
 * Resolve all currencyField elements in a template.
 * Formats values with currency symbols and converts to text elements.
 *
 * @param template - The pdfme template with schemas
 * @param inputs - Array of input records
 * @param locale - Optional locale configuration
 * @returns Modified template and inputs with currency fields resolved to text
 */
export function resolveCurrencyFields(
  template: { basePdf: unknown; schemas: unknown[] },
  inputs: Record<string, string>[],
  locale?: LocaleConfig,
): { template: { basePdf: unknown; schemas: unknown[] }; inputs: Record<string, string>[] } {
  if (!Array.isArray(template.schemas)) return { template, inputs };

  // Build a data context from the first input record
  const context: Record<string, unknown> = {};
  if (inputs.length > 0) {
    for (const [key, value] of Object.entries(inputs[0])) {
      const num = Number(value);
      context[key] = isNaN(num) || value === '' ? value : num;
    }
  }

  const resolvedFields: FormattedCurrencyResult[] = [];

  const newSchemas = template.schemas.map((page: unknown) => {
    if (!Array.isArray(page)) return page;
    return page.map((field: unknown) => {
      if (
        !field ||
        typeof field !== 'object' ||
        !('type' in field) ||
        (field as { type: string }).type !== 'currencyField'
      ) {
        return field;
      }

      const currencySchema = field as CurrencyFieldSchema;
      const fieldName = currencySchema.name;

      // Get the raw value from inputs
      const rawStr = inputs.length > 0 ? inputs[0][fieldName] : undefined;
      const rawValue = rawStr !== undefined && rawStr !== '' ? Number(rawStr) : 0;

      // Format the currency value
      const formatted = formatCurrencyField(
        isNaN(rawValue) ? 0 : rawValue,
        currencySchema,
        locale,
        context,
      );

      resolvedFields.push(formatted);

      // Determine height: dual currency 'below' format may need more height
      let height = currencySchema.height;
      if (formatted.dualCurrencyValue && currencySchema.dualCurrency?.format !== 'inline') {
        // Give extra height for the second line
        height = Math.max(height, (currencySchema.fontSize || 12) * 2.5);
      }

      // Convert to a text element
      return {
        name: fieldName,
        type: 'text',
        position: currencySchema.position,
        width: currencySchema.width,
        height,
        fontSize: currencySchema.fontSize || 12,
        fontName: currencySchema.fontName || undefined,
        alignment: currencySchema.alignment || 'right', // Currency defaults to right-aligned
        fontColor: currencySchema.fontColor || '#000000',
      };
    });
  });

  // Update inputs with formatted currency values
  const newInputs = inputs.map((input) => {
    const updated = { ...input };
    for (const resolved of resolvedFields) {
      updated[resolved.name] = resolved.formattedValue;
    }
    return updated;
  });

  return {
    template: { basePdf: template.basePdf, schemas: newSchemas },
    inputs: newInputs,
  };
}

/**
 * The currencyField plugin definition.
 */
export const currencyField = {
  type: 'currencyField' as const,

  defaultSchema: {
    type: 'currencyField',
    currencyCode: 'USD',
    symbolPosition: 'before',
    decimalPlaces: 2,
    fontSize: 12,
    alignment: 'right',
    fontColor: '#000000',
    position: { x: 0, y: 0 },
    width: 60,
    height: 15,
  },

  resolveCurrencySymbol,
  formatCurrencyValue,
  formatCurrencyField,
  resolveCurrencyFields,
};
