'use client';

import React, { useState, useEffect, useCallback } from 'react';

export interface PrintDialogProps {
  open: boolean;
  onClose: () => void;
  apiBase: string;
  authToken?: string;
  templateId?: string;
  templateName?: string;
  /** Page dimensions in points for actual-size preview */
  pageWidth?: number;
  pageHeight?: number;
  /** Current template schema for preview rendering */
  templateSchema?: unknown;
  onPrintSuccess?: (jobId: string) => void;
  onPrintError?: (error: string) => void;
}

interface Printer {
  id: string;
  name: string;
  host: string;
  port: number;
  type: string;
  isDefault: string;
}

type PrintStatus = 'idle' | 'printing' | 'success' | 'error';

/**
 * PrintDialog - Modal dialog for printer selection, quantity input,
 * actual-size preview, and direct print job submission.
 */
export default function PrintDialog({
  open,
  onClose,
  apiBase,
  authToken,
  templateId,
  templateName,
  pageWidth = 595,
  pageHeight = 842,
  templateSchema,
  onPrintSuccess,
  onPrintError,
}: PrintDialogProps) {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [printerError, setPrinterError] = useState<string | null>(null);
  const [selectedPrinterId, setSelectedPrinterId] = useState<string>('');
  const [quantity, setQuantity] = useState(1);
  const [printStatus, setPrintStatus] = useState<PrintStatus>('idle');
  const [printError, setPrintError] = useState<string | null>(null);
  const [printJobId, setPrintJobId] = useState<string | null>(null);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  // Fetch printers when dialog opens
  useEffect(() => {
    if (!open) return;

    // Reset state
    setPrintStatus('idle');
    setPrintError(null);
    setPrintJobId(null);

    const fetchPrinters = async () => {
      setLoadingPrinters(true);
      setPrinterError(null);
      try {
        const res = await fetch(`${apiBase}/printers`, { headers });
        if (!res.ok) {
          if (res.status === 401) {
            setPrinterError('Authentication required. Please log in.');
          } else {
            setPrinterError(`Failed to load printers (${res.status})`);
          }
          setPrinters([]);
          return;
        }
        const body = await res.json();
        const printerList: Printer[] = body.data || [];
        setPrinters(printerList);

        // Auto-select default printer or first printer
        if (printerList.length > 0) {
          const defaultPrinter = printerList.find((p) => p.isDefault === 'true');
          setSelectedPrinterId(defaultPrinter?.id || printerList[0].id);
        } else {
          setSelectedPrinterId('');
        }
      } catch (err: any) {
        setPrinterError(`Failed to load printers: ${err.message}`);
        setPrinters([]);
      } finally {
        setLoadingPrinters(false);
      }
    };

    fetchPrinters();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePrint = useCallback(async () => {
    if (!selectedPrinterId || !templateId) return;

    setPrintStatus('printing');
    setPrintError(null);

    try {
      // Build inputs array based on quantity
      const inputs: Record<string, string>[] = [];
      for (let i = 0; i < quantity; i++) {
        inputs.push({});
      }

      const res = await fetch(`${apiBase}/print`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          templateId,
          printerId: selectedPrinterId,
          inputs,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: `Print failed (${res.status})` }));
        throw new Error(body.message || `Print failed (${res.status})`);
      }

      const result = await res.json();
      setPrintJobId(result.jobId);
      setPrintStatus('success');
      onPrintSuccess?.(result.jobId);
    } catch (err: any) {
      setPrintError(err.message);
      setPrintStatus('error');
      onPrintError?.(err.message);
    }
  }, [selectedPrinterId, templateId, quantity, apiBase, authToken]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  // Calculate actual-size preview dimensions
  // 1pt = 1/72 inch, screen DPI ~96 => scale = 96/72 = 1.333
  const screenDpi = 96;
  const ptToScreenPx = screenDpi / 72;
  const previewWidthPx = Math.round(pageWidth * ptToScreenPx);
  const previewHeightPx = Math.round(pageHeight * ptToScreenPx);

  // Scale preview to fit in available space (max 300px width)
  const maxPreviewWidth = 300;
  const previewScale = Math.min(1, maxPreviewWidth / previewWidthPx);
  const scaledWidth = Math.round(previewWidthPx * previewScale);
  const scaledHeight = Math.round(previewHeightPx * previewScale);

  const noPrinters = printers.length === 0 && !loadingPrinters && !printerError;

  return (
    <div
      data-testid="print-dialog-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="print-dialog"
        role="dialog"
        aria-label="Print dialog"
        aria-modal="true"
        style={{
          backgroundColor: '#fff',
          borderRadius: '12px',
          padding: '24px',
          minWidth: '480px',
          maxWidth: '600px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          position: 'relative',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#1e293b' }}>
            Print Label
          </h2>
          <button
            data-testid="print-dialog-close"
            onClick={onClose}
            aria-label="Close print dialog"
            style={{
              background: 'none',
              border: 'none',
              fontSize: '20px',
              cursor: 'pointer',
              color: '#64748b',
              padding: '4px',
            }}
          >
            &#x2715;
          </button>
        </div>

        {/* Template info */}
        <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
            Template
          </div>
          <div data-testid="print-dialog-template-name" style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>
            {templateName || templateId || 'Untitled'}
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
            {Math.round(pageWidth / 2.83465)}mm &times; {Math.round(pageHeight / 2.83465)}mm
          </div>
        </div>

        {/* Actual-size preview */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', fontWeight: 600 }}>
            Actual Size Preview (1:1)
          </div>
          <div
            data-testid="print-preview-panel"
            data-preview-width={previewWidthPx}
            data-preview-height={previewHeightPx}
            data-preview-scale={previewScale.toFixed(3)}
            style={{
              width: `${scaledWidth}px`,
              height: `${scaledHeight}px`,
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              backgroundColor: '#fff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
              margin: '0 auto',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: '11px',
                color: '#94a3b8',
                textAlign: 'center',
              }}
            >
              {Math.round(pageWidth / 2.83465)}mm &times; {Math.round(pageHeight / 2.83465)}mm
              <br />
              <span style={{ fontSize: '10px' }}>1:1 scale</span>
            </div>
          </div>
        </div>

        {/* Printer selection */}
        <div style={{ marginBottom: '16px' }}>
          <label
            htmlFor="printer-select"
            style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}
          >
            Printer
          </label>

          {loadingPrinters && (
            <div data-testid="printer-loading" style={{ padding: '8px', fontSize: '13px', color: '#64748b' }}>
              Loading printers...
            </div>
          )}

          {printerError && (
            <div data-testid="printer-error" style={{ padding: '8px', fontSize: '13px', color: '#dc2626', backgroundColor: '#fef2f2', borderRadius: '6px', border: '1px solid #fecaca' }}>
              {printerError}
            </div>
          )}

          {noPrinters && (
            <div
              data-testid="no-printers-message"
              style={{
                padding: '16px',
                fontSize: '13px',
                color: '#92400e',
                backgroundColor: '#fffbeb',
                borderRadius: '8px',
                border: '1px solid #fde68a',
                lineHeight: '1.5',
              }}
            >
              <strong>No printers configured.</strong>
              <br />
              To set up a printer, use the API:
              <br />
              <code style={{ fontSize: '11px', backgroundColor: '#fef3c7', padding: '2px 4px', borderRadius: '3px' }}>
                POST /api/pdfme/printers
              </code>
              <br />
              with <code style={{ fontSize: '11px' }}>{`{ "name": "...", "host": "192.168.x.x" }`}</code>
            </div>
          )}

          {!loadingPrinters && !printerError && printers.length > 0 && (
            <select
              id="printer-select"
              data-testid="printer-select"
              value={selectedPrinterId}
              onChange={(e) => setSelectedPrinterId(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '14px',
                color: '#334155',
                backgroundColor: '#fff',
              }}
            >
              {printers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.host}:{p.port})
                  {p.isDefault === 'true' ? ' ★ Default' : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Quantity */}
        <div style={{ marginBottom: '20px' }}>
          <label
            htmlFor="print-quantity"
            style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}
          >
            Copies
          </label>
          <input
            id="print-quantity"
            data-testid="print-quantity"
            type="number"
            min={1}
            max={999}
            value={quantity}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!isNaN(val) && val >= 1 && val <= 999) {
                setQuantity(val);
              }
            }}
            style={{
              width: '100px',
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              fontSize: '14px',
              color: '#334155',
            }}
          />
        </div>

        {/* Status messages */}
        {printStatus === 'success' && (
          <div
            data-testid="print-success"
            style={{
              marginBottom: '16px',
              padding: '12px',
              backgroundColor: '#f0fdf4',
              border: '1px solid #86efac',
              borderRadius: '8px',
              fontSize: '13px',
              color: '#166534',
            }}
          >
            Print job sent successfully! Job ID: <strong>{printJobId}</strong>
          </div>
        )}

        {printStatus === 'error' && printError && (
          <div
            data-testid="print-error"
            style={{
              marginBottom: '16px',
              padding: '12px',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              fontSize: '13px',
              color: '#dc2626',
            }}
          >
            Print failed: {printError}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            data-testid="print-dialog-cancel"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              backgroundColor: '#fff',
              color: '#334155',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {printStatus === 'success' ? 'Close' : 'Cancel'}
          </button>
          <button
            data-testid="print-dialog-confirm"
            onClick={handlePrint}
            disabled={!selectedPrinterId || !templateId || printStatus === 'printing' || noPrinters}
            style={{
              padding: '8px 20px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: (!selectedPrinterId || !templateId || printStatus === 'printing' || noPrinters) ? '#94a3b8' : '#2563eb',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 600,
              cursor: (!selectedPrinterId || !templateId || printStatus === 'printing' || noPrinters) ? 'not-allowed' : 'pointer',
              opacity: printStatus === 'printing' ? 0.7 : 1,
            }}
          >
            {printStatus === 'printing' ? 'Sending...' : printStatus === 'success' ? 'Print Again' : 'Print'}
          </button>
        </div>
      </div>
    </div>
  );
}
