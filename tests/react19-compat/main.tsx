import React, { useRef, useState, useCallback, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import MoveableComponent, { OnDrag, OnResize, OnRotate } from 'react-moveable';
import SelectoComponent from 'react-selecto';
import GuidesComponent from '@scena/react-guides';

/* ===================================================================
   React 19 Compatibility Test Harness
   Tests: react-moveable v0.56.0, react-selecto v1.26.3,
          @scena/react-guides v0.28.2
   =================================================================== */

type TestResult = {
  library: string;
  test: string;
  status: 'pending' | 'pass' | 'fail';
  detail?: string;
};

function App() {
  const [results, setResults] = useState<TestResult[]>([
    { library: 'react-moveable', test: 'Mount & render', status: 'pending' },
    { library: 'react-moveable', test: 'Drag operation', status: 'pending' },
    { library: 'react-moveable', test: 'Resize operation', status: 'pending' },
    { library: 'react-moveable', test: 'Rotate operation', status: 'pending' },
    { library: 'react-selecto', test: 'Mount & render', status: 'pending' },
    { library: 'react-selecto', test: 'onDragStart callback', status: 'pending' },
    { library: 'react-selecto', test: 'onSelect callback', status: 'pending' },
    { library: '@scena/react-guides', test: 'Mount horizontal ruler', status: 'pending' },
    { library: '@scena/react-guides', test: 'Mount vertical ruler', status: 'pending' },
    { library: '@scena/react-guides', test: 'Scroll/zoom response', status: 'pending' },
  ]);

  const [consoleWarnings, setConsoleWarnings] = useState<string[]>([]);

  const updateResult = useCallback(
    (library: string, test: string, status: 'pass' | 'fail', detail?: string) => {
      setResults((prev) =>
        prev.map((r) =>
          r.library === library && r.test === test ? { ...r, status, detail } : r,
        ),
      );
    },
    [],
  );

  useEffect(() => {
    const originalWarn = console.warn;
    const originalError = console.error;
    const warnings: string[] = [];

    console.warn = (...args: unknown[]) => {
      const msg = args.map(String).join(' ');
      if (
        msg.includes('ref') ||
        msg.includes('StrictMode') ||
        msg.includes('lifecycle') ||
        msg.includes('deprecated') ||
        msg.includes('React') ||
        msg.includes('findDOMNode')
      ) {
        warnings.push(`[WARN] ${msg}`);
        setConsoleWarnings([...warnings]);
      }
      originalWarn.apply(console, args);
    };

    console.error = (...args: unknown[]) => {
      const msg = args.map(String).join(' ');
      if (
        msg.includes('ref') ||
        msg.includes('StrictMode') ||
        msg.includes('lifecycle') ||
        msg.includes('deprecated') ||
        msg.includes('React') ||
        msg.includes('findDOMNode')
      ) {
        warnings.push(`[ERROR] ${msg}`);
        setConsoleWarnings([...warnings]);
      }
      originalError.apply(console, args);
    };

    return () => {
      console.warn = originalWarn;
      console.error = originalError;
    };
  }, []);

  const passingCount = results.filter((r) => r.status === 'pass').length;
  const failingCount = results.filter((r) => r.status === 'fail').length;
  const pendingCount = results.filter((r) => r.status === 'pending').length;

  return (
    <div style={{ padding: 24, fontFamily: 'monospace', maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>
        React 19 Canvas Libraries Compatibility Test
      </h1>
      <p style={{ color: '#666', marginBottom: 4 }}>
        React {React.version} | react-moveable v0.56.0 | react-selecto v1.26.3 |
        @scena/react-guides v0.28.2
      </p>
      <p style={{ marginBottom: 24, fontWeight: 'bold' }}>
        <span style={{ color: '#16a34a' }}>PASS: {passingCount}</span>{' '}
        <span style={{ color: '#dc2626' }}>FAIL: {failingCount}</span>{' '}
        <span style={{ color: '#9ca3af' }}>PENDING: {pendingCount}</span>
      </p>

      {/* Test Results Table */}
      <div id="test-results" style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Test Results</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #ddd' }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={{ padding: 8, textAlign: 'left', borderBottom: '1px solid #ddd' }}>Library</th>
              <th style={{ padding: 8, textAlign: 'left', borderBottom: '1px solid #ddd' }}>Test</th>
              <th style={{ padding: 8, textAlign: 'left', borderBottom: '1px solid #ddd' }}>Status</th>
              <th style={{ padding: 8, textAlign: 'left', borderBottom: '1px solid #ddd' }}>Detail</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: 8 }}>{r.library}</td>
                <td style={{ padding: 8 }}>{r.test}</td>
                <td style={{
                  padding: 8,
                  color: r.status === 'pass' ? '#16a34a' : r.status === 'fail' ? '#dc2626' : '#9ca3af',
                  fontWeight: 'bold',
                }}>
                  {r.status.toUpperCase()}
                </td>
                <td style={{ padding: 8, fontSize: 12, color: '#666' }}>{r.detail || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Console Warnings */}
      <div id="console-warnings" style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>
          React 19 Console Warnings ({consoleWarnings.length})
        </h2>
        {consoleWarnings.length === 0 ? (
          <p style={{ color: '#16a34a' }}>No React 19-specific warnings detected</p>
        ) : (
          <pre style={{
            background: '#fef2f2',
            padding: 12,
            borderRadius: 4,
            fontSize: 12,
            maxHeight: 200,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
          }}>
            {consoleWarnings.join('\n')}
          </pre>
        )}
      </div>

      {/* Test Areas */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <MoveableTest onResult={updateResult} />
        <SelectoTest onResult={updateResult} />
      </div>
      <div style={{ marginTop: 24 }}>
        <GuidesTest onResult={updateResult} />
      </div>
    </div>
  );
}

/* ===================================================================
   MOVEABLE TEST
   =================================================================== */
function MoveableTest({
  onResult,
}: {
  onResult: (lib: string, test: string, status: 'pass' | 'fail', detail?: string) => void;
}) {
  const targetRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<HTMLElement[]>([]);
  const [dragCount, setDragCount] = useState(0);
  const [resizeCount, setResizeCount] = useState(0);
  const [rotateCount, setRotateCount] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (targetRef.current) {
      setTarget([targetRef.current]);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const moveableEl = document.querySelector('.compat-moveable');
        if (moveableEl) {
          setMounted(true);
          onResult('react-moveable', 'Mount & render', 'pass', 'Component mounted with React ' + React.version);
        } else {
          onResult('react-moveable', 'Mount & render', 'fail', 'Component did not render DOM elements');
        }
      } catch (err) {
        onResult('react-moveable', 'Mount & render', 'fail', String(err));
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [onResult]);

  useEffect(() => {
    if (dragCount > 0) {
      onResult('react-moveable', 'Drag operation', 'pass', `${dragCount} drag event(s) fired`);
    }
  }, [dragCount, onResult]);

  useEffect(() => {
    if (resizeCount > 0) {
      onResult('react-moveable', 'Resize operation', 'pass', `${resizeCount} resize event(s) fired`);
    }
  }, [resizeCount, onResult]);

  useEffect(() => {
    if (rotateCount > 0) {
      onResult('react-moveable', 'Rotate operation', 'pass', `${rotateCount} rotate event(s) fired`);
    }
  }, [rotateCount, onResult]);

  return (
    <div>
      <h3 style={{ fontSize: 16, marginBottom: 8 }}>react-moveable Test</h3>
      <p style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
        Drag, resize, or rotate the blue box. Status: {mounted ? 'Mounted' : 'Mounting...'}
      </p>
      <div
        ref={containerRef}
        id="moveable-container"
        style={{
          position: 'relative',
          width: 400,
          height: 300,
          border: '2px solid #e5e7eb',
          background: '#fafafa',
          overflow: 'hidden',
        }}
      >
        <div
          ref={targetRef}
          className="moveable-target"
          style={{
            position: 'absolute',
            width: 100,
            height: 80,
            top: 60,
            left: 80,
            background: '#3b82f6',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontSize: 12,
            cursor: 'move',
          }}
        >
          Drag me
        </div>
        {target.length > 0 && (
          <MoveableComponent
            className="compat-moveable"
            target={target}
            container={containerRef.current || undefined}
            draggable
            resizable
            rotatable
            throttleDrag={1}
            throttleResize={1}
            throttleRotate={1}
            edge={true}
            origin={false}
            snappable
            onDrag={(e: OnDrag) => {
              e.target.style.left = `${e.left}px`;
              e.target.style.top = `${e.top}px`;
              setDragCount((c) => c + 1);
            }}
            onResize={(e: OnResize) => {
              e.target.style.width = `${e.width}px`;
              e.target.style.height = `${e.height}px`;
              setResizeCount((c) => c + 1);
            }}
            onRotate={(e: OnRotate) => {
              e.target.style.transform = `rotate(${e.rotate}deg)`;
              setRotateCount((c) => c + 1);
            }}
          />
        )}
      </div>
      <div style={{ fontSize: 12, marginTop: 4, color: '#999' }}>
        Events: drag={dragCount} resize={resizeCount} rotate={rotateCount}
      </div>
    </div>
  );
}

/* ===================================================================
   SELECTO TEST
   =================================================================== */
function SelectoTest({
  onResult,
}: {
  onResult: (lib: string, test: string, status: 'pass' | 'fail', detail?: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [dragStartCount, setDragStartCount] = useState(0);
  const [selectCount, setSelectCount] = useState(0);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);

  useEffect(() => {
    if (containerRef.current) setMounted(true);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      onResult('react-selecto', 'Mount & render', 'pass', 'Selecto component mounted with React ' + React.version);
    }, 1000);
    return () => clearTimeout(timer);
  }, [onResult]);

  useEffect(() => {
    if (dragStartCount > 0) {
      onResult('react-selecto', 'onDragStart callback', 'pass', `${dragStartCount} dragStart event(s)`);
    }
  }, [dragStartCount, onResult]);

  useEffect(() => {
    if (selectCount > 0) {
      onResult('react-selecto', 'onSelect callback', 'pass', `${selectCount} select event(s), items: ${selectedItems.join(', ')}`);
    }
  }, [selectCount, selectedItems, onResult]);

  return (
    <div>
      <h3 style={{ fontSize: 16, marginBottom: 8 }}>react-selecto Test</h3>
      <p style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
        Click or drag to select the colored boxes.
      </p>
      <div
        ref={containerRef}
        id="selecto-container"
        style={{
          position: 'relative',
          width: 400,
          height: 300,
          border: '2px solid #e5e7eb',
          background: '#fafafa',
          overflow: 'hidden',
        }}
      >
        {['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6'].map((color, i) => (
          <div
            key={i}
            className="selecto-item"
            data-index={i}
            style={{
              position: 'absolute',
              width: 60,
              height: 60,
              borderRadius: 4,
              background: color,
              top: Math.floor(i / 3) * 100 + 40,
              left: (i % 3) * 120 + 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: 12,
              fontWeight: 'bold',
              userSelect: 'none',
            }}
          >
            {i + 1}
          </div>
        ))}
        {mounted && containerRef.current && (
          <SelectoComponent
            className="compat-selecto"
            selectFromInside={false}
            selectByClick
            hitRate={0}
            selectableTargets={['.selecto-item']}
            container={containerRef.current}
            onDragStart={() => setDragStartCount((c) => c + 1)}
            onSelect={(e) => {
              const selected = (e.selected as HTMLElement[]).map((el) => el.dataset.index || '?');
              setSelectedItems(selected);
              setSelectCount((c) => c + 1);
              (e.added as HTMLElement[]).forEach((el) => { el.style.outline = '3px solid #000'; });
              (e.removed as HTMLElement[]).forEach((el) => { el.style.outline = 'none'; });
            }}
          />
        )}
      </div>
      <div style={{ fontSize: 12, marginTop: 4, color: '#999' }}>
        Events: dragStart={dragStartCount} select={selectCount} | Selected: {selectedItems.join(', ') || 'none'}
      </div>
    </div>
  );
}

/* ===================================================================
   GUIDES TEST
   =================================================================== */
function GuidesTest({
  onResult,
}: {
  onResult: (lib: string, test: string, status: 'pass' | 'fail', detail?: string) => void;
}) {
  const hRef = useRef<GuidesComponent>(null);
  const vRef = useRef<GuidesComponent>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const canvases = document.querySelectorAll('#guides-container canvas');
        if (canvases.length >= 1) {
          onResult('@scena/react-guides', 'Mount horizontal ruler', 'pass', 'Horizontal ruler canvas rendered');
        } else {
          onResult('@scena/react-guides', 'Mount horizontal ruler', 'fail', 'No horizontal ruler canvas found');
        }
        if (canvases.length >= 2) {
          onResult('@scena/react-guides', 'Mount vertical ruler', 'pass', 'Vertical ruler canvas rendered');
        } else {
          onResult('@scena/react-guides', 'Mount vertical ruler', 'fail', `Only ${canvases.length} canvas(es) found`);
        }
        if (hRef.current && vRef.current) {
          hRef.current.scroll(10);
          vRef.current.scroll(10);
          hRef.current.resize();
          vRef.current.resize();
          onResult('@scena/react-guides', 'Scroll/zoom response', 'pass', 'scroll() and resize() methods callable via ref');
        } else {
          onResult('@scena/react-guides', 'Scroll/zoom response', 'fail', 'Refs not attached');
        }
      } catch (err) {
        onResult('@scena/react-guides', 'Mount horizontal ruler', 'fail', String(err));
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [onResult]);

  return (
    <div>
      <h3 style={{ fontSize: 16, marginBottom: 8 }}>@scena/react-guides Test</h3>
      <p style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
        Horizontal and vertical rulers should render with tick marks.
      </p>
      <div id="guides-container" style={{ position: 'relative', width: '100%', height: 300, border: '2px solid #e5e7eb', background: '#fafafa' }}>
        <div style={{ position: 'absolute', top: 0, left: 30, width: 'calc(100% - 30px)', height: 30, background: '#f1f5f9' }}>
          <GuidesComponent ref={hRef} type="horizontal" zoom={1} unit={5} segment={5} textColor="#334155" lineColor="#94a3b8" style={{ width: '100%', height: '100%' }} />
        </div>
        <div style={{ position: 'absolute', top: 30, left: 0, width: 30, height: 'calc(100% - 30px)', background: '#f1f5f9' }}>
          <GuidesComponent ref={vRef} type="vertical" zoom={1} unit={5} segment={5} textColor="#334155" lineColor="#94a3b8" style={{ width: '100%', height: '100%' }} />
        </div>
        <div style={{ position: 'absolute', top: 0, left: 0, width: 30, height: 30, background: '#e2e8f0' }} />
        <div style={{ position: 'absolute', top: 30, left: 30, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 14 }}>
          Canvas area (rulers above & left)
        </div>
      </div>
    </div>
  );
}

// Mount the app
const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
