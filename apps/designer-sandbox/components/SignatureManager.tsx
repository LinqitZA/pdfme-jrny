'use client';

import { useRef, useState, useCallback, useEffect } from 'react';

interface SignatureManagerProps {
  apiBase?: string;
  authToken?: string;
  orgId?: string;
  onSave?: (result: { id: string; filePath: string; capturedAt: string }) => void;
  onClear?: () => void;
  width?: number;
  height?: number;
  penColor?: string;
  penWidth?: number;
  backgroundColor?: string;
}

/**
 * SignatureManager - HTML5 Canvas signature drawing component
 *
 * Features:
 * - Draw signature on HTML5 Canvas with mouse/touch
 * - Clear button to reset the canvas
 * - Submit saves as PNG (base64) to the backend
 * - SVG export option
 * - Responsive canvas sizing
 */
export default function SignatureManager({
  apiBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3001/api/pdfme',
  authToken,
  orgId,
  onSave,
  onClear,
  width = 500,
  height = 200,
  penColor = '#000000',
  penWidth = 2,
  backgroundColor = '#ffffff',
}: SignatureManagerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedResult, setSavedResult] = useState<{ id: string; filePath: string; capturedAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const strokesRef = useRef<Array<Array<{ x: number; y: number }>>>([]);
  const currentStrokeRef = useRef<Array<{ x: number; y: number }>>([]);

  // Initialize canvas with white background
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, [backgroundColor]);

  const getPosition = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ('touches' in e) {
      const touch = e.touches[0];
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const startDrawing = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    setHasDrawn(true);
    setError(null);
    setSavedResult(null);

    const pos = getPosition(e);
    currentStrokeRef.current = [pos];

    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.strokeStyle = penColor;
    ctx.lineWidth = penWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, [getPosition, penColor, penWidth]);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pos = getPosition(e);
    currentStrokeRef.current.push(pos);

    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }, [isDrawing, getPosition]);

  const stopDrawing = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);

    if (currentStrokeRef.current.length > 0) {
      strokesRef.current.push([...currentStrokeRef.current]);
      currentStrokeRef.current = [];
    }
  }, [isDrawing]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    strokesRef.current = [];
    currentStrokeRef.current = [];
    setHasDrawn(false);
    setSavedResult(null);
    setError(null);
    onClear?.();
  }, [backgroundColor, onClear]);

  const exportAsPng = useCallback((): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.toDataURL('image/png');
  }, []);

  const exportAsSvg = useCallback((): string | null => {
    if (strokesRef.current.length === 0) return null;

    const paths = strokesRef.current.map((stroke) => {
      if (stroke.length === 0) return '';
      const d = stroke.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
      return `<path d="${d}" stroke="${penColor}" stroke-width="${penWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join('\n  ');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n  <rect width="${width}" height="${height}" fill="${backgroundColor}"/>\n  ${paths}\n</svg>`;
  }, [penColor, penWidth, width, height, backgroundColor]);

  const saveSignature = useCallback(async (format: 'png' | 'svg' = 'png') => {
    if (!hasDrawn) {
      setError('Please draw a signature first');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      let data: string;
      if (format === 'svg') {
        const svg = exportAsSvg();
        if (!svg) throw new Error('Failed to export SVG');
        data = 'data:image/svg+xml;base64,' + btoa(svg);
      } else {
        const png = exportAsPng();
        if (!png) throw new Error('Failed to export PNG');
        data = png;
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const response = await fetch(`${apiBase}/signatures`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ data, orgId }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: 'Upload failed' }));
        throw new Error(err.message || `HTTP ${response.status}`);
      }

      const result = await response.json();
      setSavedResult(result);
      onSave?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save signature');
    } finally {
      setSaving(false);
    }
  }, [hasDrawn, exportAsPng, exportAsSvg, apiBase, authToken, orgId, onSave]);

  return (
    <div className="signature-manager" data-testid="signature-manager" style={{ maxWidth: width + 20 }}>
      <div style={{ marginBottom: 8 }}>
        <strong>Draw your signature below:</strong>
      </div>

      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        data-testid="signature-canvas"
        style={{
          border: '2px solid #ccc',
          borderRadius: 4,
          cursor: 'crosshair',
          touchAction: 'none',
          maxWidth: '100%',
        }}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
      />

      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          data-testid="signature-clear"
          onClick={clearCanvas}
          style={{
            padding: '6px 16px',
            border: '1px solid #ccc',
            borderRadius: 4,
            backgroundColor: '#f5f5f5',
            cursor: 'pointer',
          }}
        >
          Clear
        </button>

        <button
          data-testid="signature-save-png"
          onClick={() => saveSignature('png')}
          disabled={!hasDrawn || saving}
          style={{
            padding: '6px 16px',
            border: '1px solid #007bff',
            borderRadius: 4,
            backgroundColor: hasDrawn && !saving ? '#007bff' : '#ccc',
            color: '#fff',
            cursor: hasDrawn && !saving ? 'pointer' : 'not-allowed',
          }}
        >
          {saving ? 'Saving...' : 'Save as PNG'}
        </button>

        <button
          data-testid="signature-save-svg"
          onClick={() => saveSignature('svg')}
          disabled={!hasDrawn || saving}
          style={{
            padding: '6px 16px',
            border: '1px solid #28a745',
            borderRadius: 4,
            backgroundColor: hasDrawn && !saving ? '#28a745' : '#ccc',
            color: '#fff',
            cursor: hasDrawn && !saving ? 'pointer' : 'not-allowed',
          }}
        >
          {saving ? 'Saving...' : 'Save as SVG'}
        </button>
      </div>

      {error && (
        <div data-testid="signature-error" style={{ color: 'red', marginTop: 8 }}>
          {error}
        </div>
      )}

      {savedResult && (
        <div data-testid="signature-success" style={{ color: 'green', marginTop: 8 }}>
          Signature saved successfully! (ID: {savedResult.id})
        </div>
      )}
    </div>
  );
}
