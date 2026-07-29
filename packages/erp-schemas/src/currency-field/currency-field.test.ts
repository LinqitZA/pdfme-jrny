/**
 * Tests for the currencyField plugin's binding-aware currency resolution.
 *
 * Covers:
 * - currencyCode bound to a transaction-currency field (e.g. '{{invoice.currency}}')
 * - literal currencyCode values
 * - graceful "no symbol" fallback when nothing resolves (never a wrong/static default)
 * - dual-currency: preferring a bound raw OC value over rate-conversion
 * - dual-currency: exchangeRate conversion still works when valueBinding is absent
 * - targetCurrencyCode binding resolution
 */

import { formatCurrencyField, type CurrencyFieldSchema } from './index';

function baseSchema(overrides: Partial<CurrencyFieldSchema> = {}): CurrencyFieldSchema {
  return {
    type: 'currencyField',
    name: 'amount',
    position: { x: 0, y: 0 },
    width: 60,
    height: 15,
    ...overrides,
  };
}

describe('formatCurrencyField - currencyCode binding', () => {
  it('resolves a {{binding}} currencyCode against the data context to the transaction currency symbol', () => {
    const schema = baseSchema({ currencyCode: '{{invoice.currency}}' });
    const result = formatCurrencyField(100, schema, undefined, {
      invoice: { currency: 'USD' },
    });

    expect(result.currencyCode).toBe('USD');
    expect(result.currencySymbol).toBe('$');
    expect(result.formattedValue).toContain('$');
  });

  it('uses a literal currencyCode unchanged', () => {
    const schema = baseSchema({ currencyCode: 'EUR' });
    const result = formatCurrencyField(100, schema);

    expect(result.currencyCode).toBe('EUR');
    expect(result.currencySymbol).toBe('€');
  });

  it('renders the amount with NO currency symbol when nothing resolves, instead of a wrong static default', () => {
    const schema = baseSchema({ currencyCode: '{{invoice.currency}}' });
    // No context provided at all, so the binding cannot resolve.
    const result = formatCurrencyField(100, schema);

    expect(result.currencySymbol).toBe('');
    expect(result.formattedValue).not.toContain('$');
    expect(result.formattedValue).not.toContain('USD');
  });
});

describe('formatCurrencyField - dual currency, prefer bound raw OC value', () => {
  it('uses the bound raw OC amount directly (no exchangeRate multiplication) when valueBinding is set', () => {
    const schema = baseSchema({
      currencyCode: 'ZAR',
      dualCurrency: {
        enabled: true,
        targetCurrencyCode: 'USD',
        exchangeRate: 18.5, // present but must be ignored since valueBinding takes priority
        valueBinding: '{{amountOc}}',
      },
    });

    const context = { amountOc: 39100 };
    const result = formatCurrencyField(700000, schema, undefined, context);

    expect(result.dualCurrencyRaw).toBe(39100);
    // Must NOT equal value * exchangeRate (700000 * 18.5)
    expect(result.dualCurrencyRaw).not.toBe(700000 * 18.5);
    expect(result.dualCurrencyValue).toContain('39,100');
    expect(result.dualCurrencyValue).toContain('$');
  });

  it('falls back to value * exchangeRate when valueBinding is absent (unchanged behaviour)', () => {
    const schema = baseSchema({
      currencyCode: 'ZAR',
      dualCurrency: {
        enabled: true,
        targetCurrencyCode: 'USD',
        exchangeRate: 0.054,
      },
    });

    const result = formatCurrencyField(1000, schema, undefined, {});

    expect(result.dualCurrencyRaw).toBe(1000 * 0.054);
  });

  it('resolves a bound targetCurrencyCode (e.g. org operating currency)', () => {
    const schema = baseSchema({
      currencyCode: 'ZAR',
      dualCurrency: {
        enabled: true,
        targetCurrencyCode: '{{org.operatingCurrency}}',
        exchangeRate: 0.054,
      },
    });

    const result = formatCurrencyField(1000, schema, undefined, {
      org: { operatingCurrency: 'EUR' },
    });

    expect(result.dualCurrencyValue).toContain('€');
  });
});
