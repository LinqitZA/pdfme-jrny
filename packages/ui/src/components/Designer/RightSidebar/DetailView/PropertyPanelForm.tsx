/**
 * PropertyPanelForm — drop-in replacement for form-render in the Designer property panel.
 *
 * Uses react-hook-form internally for state management and antd v6 components for rendering.
 * Exposes a FormBridge API compatible with form-render's useForm().
 */
import React, { useEffect, useRef, useMemo } from 'react';
import {
  useForm,
  Controller,
  type UseFormReturn,
  type FieldErrors,
} from 'react-hook-form';
import {
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Checkbox,
  Card,
  ColorPicker,
  Row,
  Col,
} from 'antd';
import type { PropPanelSchema } from '@pdfme/common';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Color utilities
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Strip the alpha channel from a CSS color string.
 * Handles: #rrggbbaa → #rrggbb, #rgba → #rgb,
 *          rgba(r,g,b,a) → rgb(r,g,b), hsla(h,s,l,a) → hsl(h,s,l)
 *
 * Used to prevent the antd ColorPicker "disabledAlpha" warning that fires
 * when `disabledAlpha={true}` and the incoming value has alpha < 100%.
 */
function stripAlpha(color: string | undefined | null): string {
  if (!color || typeof color !== 'string') return color ?? '';

  // #rrggbbaa → #rrggbb
  if (/^#[0-9a-f]{8}$/i.test(color)) return color.slice(0, 7);

  // #rgba → #rgb
  if (/^#[0-9a-f]{4}$/i.test(color)) return color.slice(0, 4);

  // rgba(r, g, b, a) → rgb(r, g, b)
  const rgbaMatch = color.match(
    /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*[\d.]+\s*\)$/,
  );
  if (rgbaMatch) return `rgb(${rgbaMatch[1]},${rgbaMatch[2]},${rgbaMatch[3]})`;

  // hsla(h, s%, l%, a) → hsl(h, s%, l%)
  const hslaMatch = color.match(
    /^hsla\(\s*([\d.]+)\s*,\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*,\s*[\d.]+\s*\)$/,
  );
  if (hslaMatch) return `hsl(${hslaMatch[1]},${hslaMatch[2]},${hslaMatch[3]})`;

  return color;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  FormBridge — compatibility layer for form-render's useForm() API
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RHF = UseFormReturn<Record<string, any>>;

export interface FormBridge {
  /** @internal Called by PropertyPanelForm to bind the react-hook-form instance */
  _connect: (rhf: RHF) => void;
  /** Reset all fields to their default values */
  resetFields: () => void;
  /** Replace all form values */
  setValues: (values: Record<string, unknown>) => void;
  /** Get current form values */
  getValues: () => Record<string, unknown>;
  /**
   * Validate all fields.
   * Resolves with validated values on success.
   * Rejects with { errorFields: [{name, errors}] } on failure (antd-compatible).
   */
  validateFields: () => Promise<Record<string, unknown>>;
}

/**
 * Drop-in replacement for form-render's `useForm()`.
 * Returns a FormBridge connected to the PropertyPanelForm component.
 */
export function usePropertyPanelForm(): FormBridge {
  const rhfRef = useRef<RHF | null>(null);

  return useMemo<FormBridge>(
    () => ({
      _connect(rhf) {
        rhfRef.current = rhf;
      },
      resetFields() {
        rhfRef.current?.reset();
      },
      setValues(values) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rhfRef.current?.reset(values as Record<string, any>);
      },
      getValues() {
        return (rhfRef.current?.getValues() ?? {}) as Record<string, unknown>;
      },
      async validateFields() {
        const rhf = rhfRef.current;
        if (!rhf) return {};
        const valid = await rhf.trigger();
        if (valid) return rhf.getValues() as Record<string, unknown>;
        // Build antd-compatible error structure
        throw {
          values: rhf.getValues(),
          errorFields: flattenErrors(rhf.formState.errors),
          outOfDate: false,
        };
      },
    }),
    [],
  );
}

/** Flatten react-hook-form errors into antd's { name: string[], errors: string[] } format */
function flattenErrors(
  errors: FieldErrors,
  path: string[] = [],
): Array<{ name: string[]; errors: string[] }> {
  const out: Array<{ name: string[]; errors: string[] }> = [];
  for (const key of Object.keys(errors)) {
    const e = errors[key];
    if (!e) continue;
    const p = [...path, key];
    if (e.message) {
      out.push({ name: p, errors: [String(e.message)] });
    } else if (typeof e === 'object') {
      out.push(...flattenErrors(e as FieldErrors, p));
    }
  }
  return out;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Helpers
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/** Evaluate form-render hidden expressions: boolean | '{{!formData.field}}' */
function isHidden(
  hidden: boolean | string | undefined | null,
  formData: Record<string, unknown>,
): boolean {
  if (hidden == null) return false;
  if (typeof hidden === 'boolean') return hidden;
  if (typeof hidden !== 'string') return false;

  const m = hidden.match(/^\{\{(.+)\}\}$/);
  if (!m) return false;
  const expr = m[1].trim();

  // !formData.fieldName
  const neg = expr.match(/^!formData\.(\w+)$/);
  if (neg) return !formData[neg[1]];

  // formData.fieldName
  const pos = expr.match(/^formData\.(\w+)$/);
  if (pos) return Boolean(formData[pos[1]]);

  // formData.fieldName === 'value'
  const eq = expr.match(/^formData\.(\w+)\s*===?\s*['"](.+)['"]$/);
  if (eq) return formData[eq[1]] === eq[2];

  // formData.fieldName !== 'value'
  const neq = expr.match(/^formData\.(\w+)\s*!==?\s*['"](.+)['"]$/);
  if (neq) return formData[neq[1]] !== neq[2];

  // Fallback for complex expressions
  try {
    // eslint-disable-next-line no-new-func
    return Boolean(new Function('formData', `return ${expr}`)(formData));
  } catch {
    return false;
  }
}

/** Rule definition from form-render's schema format */
interface RuleDef {
  validator?: (rule: unknown, value: unknown) => boolean | Promise<boolean>;
  pattern?: string | RegExp;
  message?: string;
}

/** Convert form-render validation rules to react-hook-form rules */
function toRHFRules(rules?: RuleDef | RuleDef[], required?: boolean | string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = {};
  if (required) {
    out.required = typeof required === 'string' ? required : 'Required';
  }
  if (!rules) return out;

  const arr = Array.isArray(rules) ? rules : [rules];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fns: Record<string, (v: any) => boolean | string | Promise<boolean | string>> = {};

  arr.forEach((r, i) => {
    if (r.pattern) {
      const re = typeof r.pattern === 'string' ? new RegExp(r.pattern) : r.pattern;
      out.pattern = { value: re, message: r.message || 'Invalid format' };
    }
    if (r.validator) {
      const { validator, message = 'Validation failed' } = r;
      fns[`v${i}`] = (v) => {
        try {
          const res = validator(null, v);
          return res instanceof Promise
            ? res.then((ok) => (ok ? true : message))
            : res
              ? true
              : message;
        } catch {
          return message;
        }
      };
    }
  });

  if (Object.keys(fns).length) out.validate = fns;
  return out;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Internal types
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

type Ctrl = RHF['control'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Widgets = Record<string, (props: any) => React.JSX.Element>;
/** Shorthand for a field schema record */
type FS = Record<string, unknown>;

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  StandardField — renders a single form control
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const StandardField: React.FC<{ path: string; fs: FS; control: Ctrl }> = ({
  path,
  fs,
  control,
}) => {
  const widget = fs.widget as string | undefined;
  const type = fs.type as string;
  const extra = (fs.props || {}) as Record<string, unknown>;
  const off = typeof fs.disabled === 'boolean' && fs.disabled;

  return (
    <Controller
      name={path}
      control={control}
      rules={toRHFRules(fs.rules as RuleDef | RuleDef[], fs.required as boolean | string)}
      render={({ field, fieldState }) => {
        let el: React.ReactNode;

        if (widget === 'select') {
          el = (
            <Select
              value={field.value}
              onChange={field.onChange}
              options={extra.options as Array<{ label: string; value: string }>}
              disabled={off}
              placeholder={fs.placeholder as string}
              style={{ width: '100%' }}
            />
          );
        } else if (widget === 'inputNumber' || type === 'number') {
          el = (
            <InputNumber
              value={field.value}
              onChange={field.onChange}
              min={(fs.min ?? extra.min) as number}
              max={(fs.max ?? extra.max) as number}
              step={extra.step as number}
              disabled={off}
              style={{ width: '100%' }}
            />
          );
        } else if (widget === 'color') {
          // When disabledAlpha is true we must ensure the value has no alpha
          // channel, otherwise antd logs a noisy console warning on every render.
          // Additionally, antd's AggregationColor sets alpha=0 for falsy values
          // (empty string / undefined = "cleared/transparent" state), so we must
          // only enable disabledAlpha when there is an actual colour value.
          const colorValue = extra.disabledAlpha
            ? stripAlpha(field.value as string)
            : (field.value as string);
          el = (
            <ColorPicker
              value={colorValue}
              onChange={(_color, hex) => field.onChange(hex)}
              disabled={off}
              disabledAlpha={!!(extra.disabledAlpha && colorValue)}
              showText
              size="small"
            />
          );
        } else if (type === 'boolean' || widget === 'switch') {
          el = <Switch checked={Boolean(field.value)} onChange={field.onChange} disabled={off} />;
        } else if (widget === 'checkbox') {
          el = (
            <Checkbox
              checked={Boolean(field.value)}
              onChange={(e) => field.onChange(e.target.checked)}
              disabled={off}
            />
          );
        } else {
          // Default: text input
          el = (
            <Input
              value={(field.value ?? '') as string}
              onChange={field.onChange}
              disabled={off}
              placeholder={fs.placeholder as string}
              autoComplete={(extra.autoComplete as string) || 'off'}
            />
          );
        }

        return (
          <Form.Item
            label={fs.title as string}
            validateStatus={fieldState.error ? 'error' : ''}
            help={fieldState.error?.message}
            style={{ marginBottom: 8 }}
          >
            {el}
          </Form.Item>
        );
      }}
    />
  );
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  ObjectField — renders nested object schemas (card / fieldset)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const ObjectField: React.FC<{
  path: string;
  fs: FS;
  control: Ctrl;
  formData: Record<string, unknown>;
  widgets: Widgets;
}> = ({ path, fs, control, formData, widgets }) => {
  const props = fs.properties as Record<string, FS> | undefined;
  if (!props) return null;

  const inner = (
    <Row gutter={[8, 0]}>
      {Object.entries(props).map(([k, sub]) => {
        if (isHidden(sub.hidden as boolean | string | undefined, formData)) return null;
        const span = (sub.span as number) || 24;

        // Nested void/widget
        if (sub.type === 'void' && sub.widget && widgets[sub.widget as string]) {
          const W = widgets[sub.widget as string];
          return (
            <Col span={span} key={k}>
              <W schema={sub} />
            </Col>
          );
        }

        // Nested object (recursive)
        if (sub.type === 'object' && sub.properties) {
          return (
            <Col span={span} key={k}>
              <ObjectField
                path={`${path}.${k}`}
                fs={sub}
                control={control}
                formData={formData}
                widgets={widgets}
              />
            </Col>
          );
        }

        // Standard field
        return (
          <Col span={span} key={k}>
            <StandardField path={`${path}.${k}`} fs={sub} control={control} />
          </Col>
        );
      })}
    </Row>
  );

  const w = fs.widget as string;
  if (w === 'card' || w === 'Card') {
    return (
      <Card size="small" title={fs.title as string} style={{ marginBottom: 8 }}>
        {inner}
      </Card>
    );
  }
  return inner;
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  PropertyPanelForm — main component (replaces FormRenderComponent)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

interface PropertyPanelFormProps {
  form: FormBridge;
  schema: PropPanelSchema;
  widgets?: Widgets;
  watch?: Record<string, (...args: unknown[]) => void>;
  locale?: string;
}

const PropertyPanelForm: React.FC<PropertyPanelFormProps> = ({
  form: bridge,
  schema,
  widgets = {},
  watch: watchConfig,
}) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rhf = useForm<Record<string, any>>({ defaultValues: {} });

  // Connect the bridge so the parent can call resetFields / setValues / etc.
  useEffect(() => {
    bridge._connect(rhf);
  }, [bridge, rhf]);

  // Watch all form values (enables hidden expression evaluation + change notification)
  const vals = rhf.watch();

  // Notify the external watch handler when form values actually change
  const prevJsonRef = useRef<string>('{}');
  useEffect(() => {
    const json = JSON.stringify(vals);
    if (json !== prevJsonRef.current) {
      prevJsonRef.current = json;
      watchConfig?.['#']?.(vals);
    }
  });

  const properties = (schema as FS).properties as Record<string, FS> | undefined;
  if (!properties) return null;

  return (
    <Form layout="vertical" size="small" colon={false}>
      <Row gutter={[8, 0]}>
        {Object.entries(properties).map(([key, fs]) => {
          if (isHidden(fs.hidden as boolean | string | undefined, vals)) return null;

          const span = (fs.span as number) || 24;
          const type = fs.type as string;
          const widget = fs.widget as string | undefined;

          // Void type or registered custom widget
          if (type === 'void' || (widget && widget in widgets)) {
            const W = widgets[widget!];
            return W ? (
              <Col span={span} key={key}>
                <W schema={fs} />
              </Col>
            ) : null;
          }

          // Nested object (card / fieldset)
          if (type === 'object' && fs.properties) {
            return (
              <Col span={span} key={key}>
                <ObjectField
                  path={key}
                  fs={fs}
                  control={rhf.control}
                  formData={vals}
                  widgets={widgets}
                />
              </Col>
            );
          }

          // Standard form field
          return (
            <Col span={span} key={key}>
              <StandardField path={key} fs={fs} control={rhf.control} />
            </Col>
          );
        })}
      </Row>
    </Form>
  );
};

export default PropertyPanelForm;
