/**
 * Expression Engine
 *
 * Built on expr-eval (MIT) with custom extensions:
 * - Arithmetic with field references
 * - String: LEFT, RIGHT, MID, UPPER, LOWER, TRIM, CONCAT, LEN
 * - Conditional: IF (nested), AND, OR, NOT
 * - Date: FORMAT, DATEDIFF, TODAY, YEAR, MONTH, DAY
 * - Numeric: FORMAT, ROUND, ABS
 * - Locale-aware: FORMAT_CURRENCY, FORMAT_DATE, FORMAT_NUMBER
 * - Sandboxed: no Node.js globals, no require(), no eval()
 */

import { Parser } from 'expr-eval';

export interface ExpressionEngineOptions {
  /** Locale for locale-aware formatting functions (e.g. 'en-ZA', 'en-US'). Defaults to 'en-US'. */
  locale?: string;
  /** ISO 4217 currency code (e.g. 'ZAR', 'USD'). Defaults to 'USD'. */
  currency?: string;
}

export class ExpressionEngine {
  private parser: Parser;
  private locale: string;
  private currency: string;

  constructor(options: ExpressionEngineOptions = {}) {
    this.locale = options.locale || 'en-US';
    this.currency = options.currency || 'USD';

    this.parser = new Parser({
      operators: {
        // Enable all standard operators
        add: true,
        concatenate: true,
        conditional: true,
        divide: true,
        factorial: false,
        multiply: true,
        power: true,
        remainder: true,
        subtract: true,
        logical: true,
        comparison: true,
        'in': false,
        assignment: false,
      },
    });

    this.registerStringFunctions();
    this.registerConditionalFunctions();
    this.registerDateFunctions();
    this.registerNumericFunctions();
    this.registerLocaleAwareFunctions();
  }

  /**
   * Evaluate an expression with the given context (field values).
   *
   * @param expression - The expression string to evaluate
   * @param context - Key-value pairs of field references and their values
   * @returns The result of the expression evaluation
   */
  evaluate(expression: string, context: Record<string, unknown> = {}): unknown {
    // Pre-process: resolve dot-notation field references like field.price
    const { processedExpr, flatContext } = this.resolveFieldReferences(expression, context);

    try {
      const parsed = this.parser.parse(processedExpr);
      return parsed.evaluate(flatContext);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Expression evaluation error: ${message}`);
    }
  }

  /**
   * Resolve dot-notation field references (e.g. field.price) into flat variable names
   * that expr-eval can handle (e.g. field_price).
   */
  private resolveFieldReferences(
    expression: string,
    context: Record<string, unknown>,
  ): { processedExpr: string; flatContext: Record<string, unknown> } {
    const flatContext: Record<string, unknown> = {};

    // Flatten nested context objects
    const flatten = (obj: Record<string, unknown>, prefix = '') => {
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
          flatten(value as Record<string, unknown>, fullKey);
        } else {
          flatContext[fullKey] = value;
        }
      }
    };
    flatten(context);

    // Replace dot-notation references with underscore-separated names in expression
    let processedExpr = expression;

    // Sort keys by length (longest first) to avoid partial replacements
    const dotKeys = Object.keys(flatContext)
      .filter((k) => k.includes('.'))
      .sort((a, b) => b.length - a.length);

    for (const dotKey of dotKeys) {
      const safeKey = dotKey.replace(/\./g, '_');
      // Use word boundary-aware replacement
      const escaped = dotKey.replace(/\./g, '\\.');
      const regex = new RegExp(`\\b${escaped}\\b`, 'g');
      processedExpr = processedExpr.replace(regex, safeKey);
      flatContext[safeKey] = flatContext[dotKey];
    }

    // Also add non-dot keys
    for (const [key, value] of Object.entries(flatContext)) {
      if (!key.includes('.')) {
        flatContext[key] = value;
      }
    }

    // Type coercion: null/undefined → 0 for numeric contexts
    // Preserve Date objects as epoch ms timestamps for date functions
    for (const key of Object.keys(flatContext)) {
      const val = flatContext[key];
      if (val === null || val === undefined) {
        flatContext[key] = 0;
      } else if (val instanceof Date) {
        flatContext[key] = val.getTime();
      }
    }

    return { processedExpr, flatContext };
  }

  /**
   * Register string manipulation functions.
   */
  private registerStringFunctions(): void {
    // LEFT(str, n) - returns first n characters
    this.parser.functions.LEFT = (str: string, n: number): string => {
      if (typeof str !== 'string') str = String(str ?? '');
      return str.substring(0, n);
    };

    // RIGHT(str, n) - returns last n characters
    this.parser.functions.RIGHT = (str: string, n: number): string => {
      if (typeof str !== 'string') str = String(str ?? '');
      return str.substring(Math.max(0, str.length - n));
    };

    // MID(str, start, length) - returns substring from start position (1-based)
    this.parser.functions.MID = (str: string, start: number, length: number): string => {
      if (typeof str !== 'string') str = String(str ?? '');
      // 1-based indexing (like Excel)
      return str.substring(start - 1, start - 1 + length);
    };

    // UPPER(str) - converts to uppercase
    this.parser.functions.UPPER = (str: string): string => {
      if (typeof str !== 'string') str = String(str ?? '');
      return str.toUpperCase();
    };

    // LOWER(str) - converts to lowercase
    this.parser.functions.LOWER = (str: string): string => {
      if (typeof str !== 'string') str = String(str ?? '');
      return str.toLowerCase();
    };

    // TRIM(str) - removes leading/trailing whitespace
    this.parser.functions.TRIM = (str: string): string => {
      if (typeof str !== 'string') str = String(str ?? '');
      return str.trim();
    };

    // CONCAT(a, b, ...) - concatenates strings
    this.parser.functions.CONCAT = (...args: unknown[]): string => {
      return args.map((a) => String(a ?? '')).join('');
    };

    // LEN(str) - returns length of string
    this.parser.functions.LEN = (str: string): number => {
      if (typeof str !== 'string') str = String(str ?? '');
      return str.length;
    };
  }

  /**
   * Register conditional/logical functions.
   */
  private registerConditionalFunctions(): void {
    // IF(condition, trueValue, falseValue)
    this.parser.functions.IF = (condition: unknown, trueVal: unknown, falseVal: unknown): unknown => {
      return condition ? trueVal : falseVal;
    };

    // AND(a, b, ...) - logical AND
    this.parser.functions.AND = (...args: unknown[]): boolean => {
      return args.every((a) => Boolean(a));
    };

    // OR(a, b, ...) - logical OR
    this.parser.functions.OR = (...args: unknown[]): boolean => {
      return args.some((a) => Boolean(a));
    };

    // NOT(value) - logical NOT
    this.parser.functions.NOT = (value: unknown): boolean => {
      return !value;
    };
  }

  /**
   * Parse a value into a Date object. Accepts Date objects, ISO strings, timestamps.
   */
  private toDate(value: unknown): Date {
    if (value instanceof Date) return value;
    if (typeof value === 'string') {
      const d = new Date(value);
      if (isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
      return d;
    }
    if (typeof value === 'number') return new Date(value);
    throw new Error(`Cannot convert to date: ${value}`);
  }

  /**
   * Register date functions: TODAY, YEAR, MONTH, DAY, DATEDIFF, FORMAT (date version).
   */
  private registerDateFunctions(): void {
    // TODAY() - returns current date as epoch ms timestamp
    this.parser.functions.TODAY = (): number => {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    };

    // YEAR(date) - extracts year from a date value
    this.parser.functions.YEAR = (value: unknown): number => {
      return this.toDate(value).getFullYear();
    };

    // MONTH(date) - extracts month (1-12) from a date value
    this.parser.functions.MONTH = (value: unknown): number => {
      return this.toDate(value).getMonth() + 1;
    };

    // DAY(date) - extracts day of month from a date value
    this.parser.functions.DAY = (value: unknown): number => {
      return this.toDate(value).getDate();
    };

    // DATEDIFF(date1, date2) - returns difference in days (date1 - date2)
    this.parser.functions.DATEDIFF = (d1: unknown, d2: unknown): number => {
      const date1 = this.toDate(d1);
      const date2 = this.toDate(d2);
      const diffMs = date1.getTime() - date2.getTime();
      return Math.round(diffMs / (1000 * 60 * 60 * 24));
    };

    // FORMAT(value, pattern) - formats a date with the given pattern
    // Supports: yyyy, yy, MM, dd, HH, mm, ss, MMMM, MMM
    this.parser.functions.FORMAT = (value: unknown, pattern: unknown): string => {
      // If the value looks numeric and pattern looks like a number format, delegate to numeric FORMAT
      if (typeof value === 'number' && typeof pattern === 'string' && (pattern.includes('#') || pattern.includes('0'))) {
        return this.formatNumber(value, pattern);
      }

      const date = this.toDate(value);
      let result = String(pattern);

      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
      const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      // Replace tokens (order matters - longer tokens first)
      result = result.replace(/yyyy/g, String(date.getFullYear()));
      result = result.replace(/yy/g, String(date.getFullYear()).slice(-2));
      result = result.replace(/MMMM/g, monthNames[date.getMonth()]);
      result = result.replace(/MMM/g, monthShort[date.getMonth()]);
      result = result.replace(/MM/g, String(date.getMonth() + 1).padStart(2, '0'));
      result = result.replace(/dd/g, String(date.getDate()).padStart(2, '0'));
      result = result.replace(/HH/g, String(date.getHours()).padStart(2, '0'));
      result = result.replace(/mm/g, String(date.getMinutes()).padStart(2, '0'));
      result = result.replace(/ss/g, String(date.getSeconds()).padStart(2, '0'));

      return result;
    };
  }

  /**
   * Format a number using a pattern like '#,##0.00'.
   * Supports: # (optional digit), 0 (required digit), , (grouping), . (decimal)
   */
  private formatNumber(value: number, pattern: string): string {
    // Split pattern into integer and decimal parts
    const patternParts = pattern.split('.');
    const intPattern = patternParts[0];
    const decPattern = patternParts.length > 1 ? patternParts[1] : '';

    // Determine decimal places from pattern
    const decimalPlaces = decPattern.length;
    const absValue = Math.abs(value);

    // Round to desired decimal places
    const rounded = decimalPlaces > 0 ? absValue.toFixed(decimalPlaces) : Math.round(absValue).toString();
    const [intPart, decPart] = rounded.split('.');

    // Apply grouping (comma separator) if pattern has commas
    let formattedInt = intPart;
    if (intPattern.includes(',')) {
      formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    // Pad with leading zeros if pattern requires
    const requiredIntDigits = (intPattern.match(/0/g) || []).length;
    if (formattedInt.length < requiredIntDigits) {
      formattedInt = formattedInt.padStart(requiredIntDigits, '0');
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
   * Register numeric functions: ROUND, ABS.
   * Note: FORMAT is shared with date functions and handles both cases.
   */
  private registerNumericFunctions(): void {
    // ROUND(value, decimals) - rounds to specified decimal places
    this.parser.functions.ROUND = (value: number, decimals: number = 0): number => {
      if (typeof value !== 'number') value = Number(value);
      if (isNaN(value)) return 0;
      const factor = Math.pow(10, decimals);
      return Math.round(value * factor) / factor;
    };

    // ABS(value) - returns absolute value
    this.parser.functions.ABS = (value: number): number => {
      if (typeof value !== 'number') value = Number(value);
      return Math.abs(value);
    };
  }

  /**
   * Register locale-aware formatting functions.
   * These use the engine's configured locale and currency.
   */
  private registerLocaleAwareFunctions(): void {
    // FORMAT_CURRENCY(value) - formats number as currency using org locale/currency
    this.parser.functions.FORMAT_CURRENCY = (value: number): string => {
      if (typeof value !== 'number') value = Number(value);
      try {
        return new Intl.NumberFormat(this.locale, {
          style: 'currency',
          currency: this.currency,
        }).format(value);
      } catch {
        // Fallback if locale/currency is invalid
        return `${this.currency} ${value.toFixed(2)}`;
      }
    };

    // FORMAT_DATE(value) - formats date using org locale
    this.parser.functions.FORMAT_DATE = (value: unknown): string => {
      const date = this.toDate(value);
      try {
        return new Intl.DateTimeFormat(this.locale).format(date);
      } catch {
        return date.toLocaleDateString();
      }
    };

    // FORMAT_NUMBER(value) - formats number using org locale separators
    this.parser.functions.FORMAT_NUMBER = (value: number): string => {
      if (typeof value !== 'number') value = Number(value);
      try {
        return new Intl.NumberFormat(this.locale).format(value);
      } catch {
        return String(value);
      }
    };
  }
}
