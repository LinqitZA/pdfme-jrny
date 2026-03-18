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

export type ExpressionErrorMode = 'emptyString' | '#ERROR' | 'fail';

export interface ExpressionEngineOptions {
  /** Locale for locale-aware formatting functions (e.g. 'en-ZA', 'en-US'). Defaults to 'en-US'. */
  locale?: string;
  /** ISO 4217 currency code (e.g. 'ZAR', 'USD'). Defaults to 'USD'. */
  currency?: string;
  /** IANA timezone identifier (e.g. 'Africa/Johannesburg', 'America/New_York'). Defaults to 'UTC'. */
  timezone?: string;
  /**
   * How to handle expression evaluation errors:
   * - 'emptyString': return empty string (show blank)
   * - '#ERROR': return '#ERROR' text
   * - 'fail': throw an error (render fails with message)
   * Defaults to '#ERROR'.
   */
  onError?: ExpressionErrorMode;
}

/**
 * Sentinel value representing a null/undefined/missing field.
 * - valueOf() returns 0, so arithmetic treats it as 0 (e.g., null + 5 = 5)
 * - String functions detect it via instanceof and treat it as '' (e.g., CONCAT(missing, 'text') = 'text')
 */
class NullSentinel {
  valueOf(): number { return 0; }
  toString(): string { return ''; }
}

/** Singleton instance for all null/undefined/missing values */
const NULL_VALUE = new NullSentinel();

export class ExpressionEngine {
  private parser: Parser;
  private locale: string;
  private currency: string;
  private timezone: string;

  constructor(options: ExpressionEngineOptions = {}) {
    this.locale = options.locale || 'en-US';
    this.currency = options.currency || 'USD';
    this.timezone = options.timezone || 'UTC';

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

      // Fill in any undefined variables with NULL_VALUE sentinel
      // This prevents "undefined variable" errors and provides correct coercion:
      // - arithmetic uses valueOf() → 0
      // - string functions detect NullSentinel → ''
      const exprVars = parsed.variables({ withMembers: false });
      for (const v of exprVars) {
        if (!(v in flatContext)) {
          flatContext[v] = NULL_VALUE;
        }
      }

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

    // Type coercion: null/undefined → NullSentinel for context-aware coercion
    // NullSentinel.valueOf() = 0 for arithmetic, detected as '' in string functions
    // Preserve Date objects as epoch ms timestamps for date functions
    for (const key of Object.keys(flatContext)) {
      const val = flatContext[key];
      if (val === null || val === undefined) {
        flatContext[key] = NULL_VALUE;
      } else if (val instanceof Date) {
        flatContext[key] = val.getTime();
      }
    }

    return { processedExpr, flatContext };
  }

  /**
   * Register string manipulation functions.
   */
  /**
   * Convert a value to string, treating NullSentinel as empty string.
   * Regular values (including 0) are converted normally via String().
   */
  private static toStr(val: unknown): string {
    if (val instanceof NullSentinel || val === null || val === undefined) return '';
    return String(val);
  }

  private registerStringFunctions(): void {
    const toStr = ExpressionEngine.toStr;

    // LEFT(str, n) - returns first n characters
    this.parser.functions.LEFT = (str: unknown, n: number): string => {
      return toStr(str).substring(0, n);
    };

    // RIGHT(str, n) - returns last n characters
    this.parser.functions.RIGHT = (str: unknown, n: number): string => {
      const s = toStr(str);
      return s.substring(Math.max(0, s.length - n));
    };

    // MID(str, start, length) - returns substring from start position (1-based)
    this.parser.functions.MID = (str: unknown, start: number, length: number): string => {
      const s = toStr(str);
      // 1-based indexing (like Excel)
      return s.substring(start - 1, start - 1 + length);
    };

    // UPPER(str) - converts to uppercase
    this.parser.functions.UPPER = (str: unknown): string => {
      return toStr(str).toUpperCase();
    };

    // LOWER(str) - converts to lowercase
    this.parser.functions.LOWER = (str: unknown): string => {
      return toStr(str).toLowerCase();
    };

    // TRIM(str) - removes leading/trailing whitespace
    this.parser.functions.TRIM = (str: unknown): string => {
      return toStr(str).trim();
    };

    // CONCAT(a, b, ...) - concatenates strings
    this.parser.functions.CONCAT = (...args: unknown[]): string => {
      return args.map((a) => toStr(a)).join('');
    };

    // LEN(str) - returns length of string
    this.parser.functions.LEN = (str: unknown): number => {
      return toStr(str).length;
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
   * Get date/time parts in the configured timezone using Intl.DateTimeFormat.
   * Returns { year, month (1-12), day, hour, minute, second }.
   */
  private getDatePartsInTimezone(date: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: this.timezone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false,
      });
      const parts = formatter.formatToParts(date);
      const get = (type: string): number => {
        const part = parts.find(p => p.type === type);
        return part ? parseInt(part.value, 10) : 0;
      };
      return {
        year: get('year'),
        month: get('month'),
        day: get('day'),
        hour: get('hour') === 24 ? 0 : get('hour'), // midnight is sometimes 24
        minute: get('minute'),
        second: get('second'),
      };
    } catch {
      // Fallback to UTC if timezone is invalid
      return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: date.getUTCHours(),
        minute: date.getUTCMinutes(),
        second: date.getUTCSeconds(),
      };
    }
  }

  /**
   * Register date functions: TODAY, YEAR, MONTH, DAY, DATEDIFF, FORMAT (date version).
   */
  private registerDateFunctions(): void {
    // TODAY() - returns current date as epoch ms timestamp, timezone-aware
    this.parser.functions.TODAY = (): number => {
      const now = new Date();
      const parts = this.getDatePartsInTimezone(now);
      // Create a UTC date representing midnight in the configured timezone
      return Date.UTC(parts.year, parts.month - 1, parts.day);
    };

    // YEAR(date) - extracts year from a date value, timezone-aware
    this.parser.functions.YEAR = (value: unknown): number => {
      const date = this.toDate(value);
      return this.getDatePartsInTimezone(date).year;
    };

    // MONTH(date) - extracts month (1-12) from a date value, timezone-aware
    this.parser.functions.MONTH = (value: unknown): number => {
      const date = this.toDate(value);
      return this.getDatePartsInTimezone(date).month;
    };

    // DAY(date) - extracts day of month from a date value, timezone-aware
    this.parser.functions.DAY = (value: unknown): number => {
      const date = this.toDate(value);
      return this.getDatePartsInTimezone(date).day;
    };

    // DATEDIFF(date1, date2) - returns difference in days (date1 - date2)
    this.parser.functions.DATEDIFF = (d1: unknown, d2: unknown): number => {
      const date1 = this.toDate(d1);
      const date2 = this.toDate(d2);
      const diffMs = date1.getTime() - date2.getTime();
      return Math.round(diffMs / (1000 * 60 * 60 * 24));
    };

    // FORMAT(value, pattern) - formats a date with the given pattern, timezone-aware
    // Supports: yyyy, yy, MM, dd, HH, mm, ss, MMMM, MMM
    this.parser.functions.FORMAT = (value: unknown, pattern: unknown): string => {
      // If the value looks numeric and pattern looks like a number format, delegate to numeric FORMAT
      if (typeof value === 'number' && typeof pattern === 'string' && (pattern.includes('#') || pattern.includes('0'))) {
        return this.formatNumber(value, pattern);
      }

      const date = this.toDate(value);
      const parts = this.getDatePartsInTimezone(date);
      let result = String(pattern);

      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
      const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      // Replace tokens (order matters - longer tokens first)
      result = result.replace(/yyyy/g, String(parts.year));
      result = result.replace(/yy/g, String(parts.year).slice(-2));
      result = result.replace(/MMMM/g, monthNames[parts.month - 1]);
      result = result.replace(/MMM/g, monthShort[parts.month - 1]);
      result = result.replace(/MM/g, String(parts.month).padStart(2, '0'));
      result = result.replace(/dd/g, String(parts.day).padStart(2, '0'));
      result = result.replace(/HH/g, String(parts.hour).padStart(2, '0'));
      result = result.replace(/mm/g, String(parts.minute).padStart(2, '0'));
      result = result.replace(/ss/g, String(parts.second).padStart(2, '0'));

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

    // FORMAT_DATE(value) - formats date using org locale and timezone
    this.parser.functions.FORMAT_DATE = (value: unknown): string => {
      const date = this.toDate(value);
      try {
        return new Intl.DateTimeFormat(this.locale, { timeZone: this.timezone }).format(date);
      } catch {
        try {
          return new Intl.DateTimeFormat(this.locale).format(date);
        } catch {
          return date.toLocaleDateString();
        }
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
