/**
 * PropertyPanelForm integration test — verifies the form-render replacement works
 * with React 19 + antd v6.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import PropertyPanelForm, {
  usePropertyPanelForm,
  type FormBridge,
} from '../../packages/ui/src/components/Designer/RightSidebar/DetailView/PropertyPanelForm.js';
import type { PropPanelSchema } from '../../packages/common/src/types.js';
import { ConfigProvider, theme } from 'antd';

// ── Test schema matching the real propPanelSchema from DetailView ──
const testSchema: PropPanelSchema = {
  type: 'object',
  column: 2,
  properties: {
    type: {
      title: 'Type',
      type: 'string',
      widget: 'select',
      props: {
        options: [
          { label: 'Text', value: 'text' },
          { label: 'Image', value: 'image' },
          { label: 'Barcode', value: 'barcode' },
        ],
      },
      required: true,
      span: 12,
    },
    name: {
      title: 'Field Name',
      type: 'string',
      required: true,
      span: 12,
      props: { autoComplete: 'off' },
    },
    editable: {
      title: 'Editable',
      type: 'boolean',
      span: 8,
    },
    required: {
      title: 'Required',
      type: 'boolean',
      span: 16,
      hidden: '{{!formData.editable}}',
    },
    position: {
      type: 'object',
      widget: 'card',
      properties: {
        x: {
          title: 'X',
          type: 'number',
          widget: 'inputNumber',
          required: true,
          span: 12,
          min: 0,
          max: 210,
        },
        y: {
          title: 'Y',
          type: 'number',
          widget: 'inputNumber',
          required: true,
          span: 12,
          min: 0,
          max: 297,
        },
      },
    },
    width: {
      title: 'Width',
      type: 'number',
      widget: 'inputNumber',
      required: true,
      span: 6,
      props: { min: 0, max: 210 },
    },
    height: {
      title: 'Height',
      type: 'number',
      widget: 'inputNumber',
      required: true,
      span: 6,
      props: { min: 0, max: 297 },
    },
    rotate: {
      title: 'Rotate',
      type: 'number',
      widget: 'inputNumber',
      max: 360,
      props: { min: 0 },
      span: 6,
    },
    opacity: {
      title: 'Opacity',
      type: 'number',
      widget: 'inputNumber',
      props: { step: 0.1, min: 0, max: 1 },
      span: 6,
    },
    fontColor: {
      title: 'Font Color',
      type: 'string',
      widget: 'color',
      props: { disabledAlpha: true },
      span: 12,
    },
  },
};

// ── Test component ──
function TestApp() {
  const form = usePropertyPanelForm();
  const [log, setLog] = React.useState<string[]>([]);
  const [status, setStatus] = React.useState<'pending' | 'pass' | 'fail'>('pending');

  // Set initial values (simulating activeSchema)
  React.useEffect(() => {
    form.setValues({
      type: 'text',
      name: 'testField',
      editable: true,
      required: false,
      position: { x: 10, y: 20 },
      width: 100,
      height: 50,
      rotate: 0,
      opacity: 1,
      fontColor: '#000000',
    });
  }, []);

  const handleWatch = React.useCallback((...args: unknown[]) => {
    const data = args[0] as Record<string, unknown>;
    const keys = Object.keys(data).filter(k => k !== 'undefined');
    if (keys.length > 0) {
      setLog((prev) => [...prev.slice(-4), `Watch: ${keys.length} keys, type=${data.type}`]);
    }
  }, []);

  // Run verification after mount
  React.useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const vals = form.getValues();
        const checks = [
          ['getValues returns type', vals.type === 'text'],
          ['getValues returns name', vals.name === 'testField'],
          ['getValues returns position.x', (vals.position as any)?.x === 10],
          ['getValues returns width', vals.width === 100],
          ['getValues returns fontColor', vals.fontColor === '#000000'],
        ] as [string, boolean][];

        const results = checks.map(([label, ok]) => `${ok ? 'PASS' : 'FAIL'}: ${label}`);
        setLog(results);
        setStatus(checks.every(([, ok]) => ok) ? 'pass' : 'fail');
      } catch (err) {
        setLog([`ERROR: ${err}`]);
        setStatus('fail');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div style={{ maxWidth: 400, margin: '20px auto', fontFamily: 'monospace' }}>
      <h2>PropertyPanelForm Test</h2>
      <div style={{
        padding: '8px 12px',
        marginBottom: 16,
        borderRadius: 4,
        background: status === 'pass' ? '#d4edda' : status === 'fail' ? '#f8d7da' : '#fff3cd',
        color: status === 'pass' ? '#155724' : status === 'fail' ? '#721c24' : '#856404',
        fontWeight: 'bold',
      }}>
        Status: {status.toUpperCase()}
      </div>
      <div style={{ background: '#f5f5f5', padding: 8, borderRadius: 4, marginBottom: 16, fontSize: 12 }}>
        {log.map((l, i) => <div key={i}>{l}</div>)}
      </div>
      <div style={{ border: '1px solid #d9d9d9', borderRadius: 8, padding: 16 }}>
        <PropertyPanelForm
          form={form}
          schema={testSchema}
          widgets={{}}
          watch={{ '#': handleWatch }}
        />
      </div>
    </div>
  );
}

// ── Mount ──
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm }}>
        <TestApp />
      </ConfigProvider>
    </React.StrictMode>,
  );
}
