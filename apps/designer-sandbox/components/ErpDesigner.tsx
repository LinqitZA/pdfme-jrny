'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { fetchFontWithCache, getFontCacheStats, clearFontCache, pruneExpiredFonts, isCacheApiAvailable } from './fontCache';

/**
 * ErpDesigner - Three-panel WYSIWYG template designer for ERP documents.
 *
 * Layout:
 *   [Left Panel: Blocks/Fields/Assets/Pages tabs]
 *   [Center Canvas: A4 template preview with rulers]
 *   [Right Panel: Properties panel]
 *
 * Toolbar: template name, page size, undo/redo, zoom, preview, save, publish
 *
 * Features:
 * - Context-sensitive properties panel (#54)
 * - Position/size inputs update elements on canvas (#55)
 * - Data binding picker with {{field.key}} syntax (#56)
 */

/** Uploaded asset metadata */
export interface AssetInfo {
  id: string;
  filename: string;
  path: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

export interface ErpDesignerProps {
  templateId?: string;
  templateName?: string;
  orgId?: string;
  authToken?: string;
  apiBase?: string;
  autoSaveInterval?: number; // ms, default 30000
  onSave?: (template: unknown) => void;
  onChange?: (template: unknown) => void;
  onAssetUpload?: (asset: AssetInfo) => void;
}

type LeftTab = 'blocks' | 'fields' | 'assets' | 'pages';

/** Element type categories for context-sensitive properties */
type ElementType =
  | 'text'
  | 'rich-text'
  | 'calculated'
  | 'image'
  | 'erp-image'
  | 'signature'
  | 'drawn-signature'
  | 'line-items'
  | 'grouped-table'
  | 'qr-barcode'
  | 'watermark';

/** Full element model with type-specific properties */
interface DesignElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  // Text properties
  content?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textAlign?: 'left' | 'center' | 'right';
  color?: string;
  lineHeight?: number;
  // Image properties
  src?: string;
  objectFit?: 'contain' | 'cover' | 'fill';
  opacity?: number;
  // Table properties
  columns?: Array<{ key: string; header: string; width: number }>;
  showHeader?: boolean;
  borderStyle?: 'solid' | 'dashed' | 'none';
  // Data binding
  binding?: string;
  // Page visibility scope
  pageScope?: 'all' | 'first' | 'last' | 'notFirst';
  // Output channel
  outputChannel?: 'both' | 'email' | 'print';
  // Text overflow strategy
  textOverflow?: 'clip' | 'truncate' | 'shrinkToFit';
  // Conditional visibility
  conditionalVisibility?: 'always' | 'conditional';
  visibilityCondition?: string;
  // Accessibility
  altText?: string;
}

/** Represents a single page in the template */
interface TemplatePage {
  id: string;
  label: string;
  elements: DesignElement[];
}

/** Available data fields for binding picker */
const DATA_FIELDS = [
  {
    group: 'Document',
    fields: [
      { key: 'document.number', label: 'Document Number', example: 'INV-2026-001' },
      { key: 'document.date', label: 'Date', example: '2026-03-18' },
      { key: 'document.dueDate', label: 'Due Date', example: '2026-04-17' },
      { key: 'document.total', label: 'Total', example: 'R 1,250.00' },
      { key: 'document.subtotal', label: 'Subtotal', example: 'R 1,086.96' },
      { key: 'document.tax', label: 'Tax', example: 'R 163.04' },
    ],
  },
  {
    group: 'Customer',
    fields: [
      { key: 'customer.name', label: 'Name', example: 'Acme Corporation' },
      { key: 'customer.email', label: 'Email', example: 'billing@acme.com' },
      { key: 'customer.address', label: 'Address', example: '123 Main St' },
      { key: 'customer.phone', label: 'Phone', example: '+27 11 123 4567' },
      { key: 'customer.vatNumber', label: 'VAT Number', example: 'VAT4530001234' },
    ],
  },
  {
    group: 'Company',
    fields: [
      { key: 'company.name', label: 'Company Name', example: 'My Company Ltd' },
      { key: 'company.regNumber', label: 'Reg Number', example: '2020/123456/07' },
      { key: 'company.address', label: 'Address', example: '456 Business Park' },
    ],
  },
];

/** Build a flat map of field key -> example value for preview mode */
const FIELD_EXAMPLES: Record<string, string> = {};
DATA_FIELDS.forEach((group) => {
  group.fields.forEach((field) => {
    FIELD_EXAMPLES[field.key] = field.example;
  });
});

/**
 * Resolve binding expressions to example values for preview mode.
 * Handles both raw binding keys (e.g., "customer.name") and
 * mustache-style templates (e.g., "{{customer.name}}").
 */
function resolveBindingToExample(text: string, binding?: string): string {
  // If there's a specific binding field, look it up
  if (binding && FIELD_EXAMPLES[binding]) {
    return FIELD_EXAMPLES[binding];
  }

  // Replace all {{key}} patterns in text with example values
  if (text && text.includes('{{')) {
    return text.replace(/\{\{([^}]+)\}\}/g, (_match, key) => {
      const trimmedKey = key.trim();
      return FIELD_EXAMPLES[trimmedKey] || `{{${trimmedKey}}}`;
    });
  }

  return text;
}

let pageIdCounter = 0;
function createPage(label: string): TemplatePage {
  pageIdCounter += 1;
  return {
    id: `page-${pageIdCounter}`,
    label,
    elements: [],
  };
}

let elementIdCounter = 0;
function createElementId(): string {
  elementIdCounter += 1;
  return `el-${elementIdCounter}`;
}

/** Default element dimensions and properties by type */
function getDefaultElement(type: ElementType): Omit<DesignElement, 'id'> {
  const base = { type, x: 50, y: 50 };
  switch (type) {
    case 'text':
      return { ...base, w: 200, h: 24, content: 'Text', fontFamily: 'Helvetica', fontSize: 14, fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left', color: '#000000', lineHeight: 1.4, textOverflow: 'clip' };
    case 'rich-text':
      return { ...base, w: 250, h: 60, content: 'Rich text content', fontFamily: 'Helvetica', fontSize: 14, fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left', color: '#000000', lineHeight: 1.5, textOverflow: 'clip' };
    case 'calculated':
      return { ...base, w: 120, h: 24, content: '0.00', fontFamily: 'Helvetica', fontSize: 14, fontWeight: 'normal', fontStyle: 'normal', textAlign: 'right', color: '#000000', lineHeight: 1.4, textOverflow: 'clip', binding: '' };
    case 'image':
      return { ...base, w: 150, h: 100, src: '', objectFit: 'contain', opacity: 100 };
    case 'erp-image':
      return { ...base, w: 150, h: 80, src: '', objectFit: 'contain', opacity: 100 };
    case 'signature':
      return { ...base, w: 200, h: 60, src: '', objectFit: 'contain', opacity: 100 };
    case 'drawn-signature':
      return { ...base, w: 200, h: 60, src: '', objectFit: 'contain', opacity: 100 };
    case 'line-items':
      return { ...base, w: 495, h: 200, columns: [{ key: 'description', header: 'Description', width: 200 }, { key: 'qty', header: 'Qty', width: 60 }, { key: 'price', header: 'Price', width: 80 }, { key: 'total', header: 'Total', width: 80 }], showHeader: true, borderStyle: 'solid' };
    case 'grouped-table':
      return { ...base, w: 495, h: 250, columns: [{ key: 'group', header: 'Group', width: 150 }, { key: 'value', header: 'Value', width: 100 }], showHeader: true, borderStyle: 'solid' };
    case 'qr-barcode':
      return { ...base, w: 80, h: 80, content: '', binding: '' };
    case 'watermark':
      return { ...base, x: 100, y: 300, w: 395, h: 200, content: 'DRAFT', fontFamily: 'Helvetica', fontSize: 72, fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center', color: '#00000015', opacity: 15, textOverflow: 'clip' };
    default:
      return { ...base, w: 100, h: 40 };
  }
}

/** Determine element type category for properties panel */
function getElementCategory(type: ElementType): 'text' | 'image' | 'table' | 'other' {
  switch (type) {
    case 'text':
    case 'rich-text':
    case 'calculated':
    case 'watermark':
      return 'text';
    case 'image':
    case 'erp-image':
    case 'signature':
    case 'drawn-signature':
      return 'image';
    case 'line-items':
    case 'grouped-table':
      return 'table';
    case 'qr-barcode':
    default:
      return 'other';
  }
}

/** Human-readable element type label */
function getElementTypeLabel(type: ElementType): string {
  const labels: Record<ElementType, string> = {
    'text': 'Text',
    'rich-text': 'Rich Text',
    'calculated': 'Calculated Field',
    'image': 'Image',
    'erp-image': 'ERP Image',
    'signature': 'Signature Block',
    'drawn-signature': 'Drawn Signature',
    'line-items': 'Line Items Table',
    'grouped-table': 'Grouped Table',
    'qr-barcode': 'QR/Barcode',
    'watermark': 'Watermark',
  };
  return labels[type] || type;
}

const BLOCK_CATEGORIES = [
  {
    name: 'Content',
    blocks: [
      { id: 'text' as ElementType, label: 'Text', icon: 'T' },
      { id: 'rich-text' as ElementType, label: 'Rich Text', icon: 'Rt' },
      { id: 'calculated' as ElementType, label: 'Calculated Field', icon: 'fx' },
    ],
  },
  {
    name: 'Media',
    blocks: [
      { id: 'image' as ElementType, label: 'Image', icon: 'Img' },
      { id: 'erp-image' as ElementType, label: 'ERP Image', icon: 'EI' },
      { id: 'signature' as ElementType, label: 'Signature Block', icon: 'Sig' },
      { id: 'drawn-signature' as ElementType, label: 'Drawn Signature', icon: 'DS' },
    ],
  },
  {
    name: 'Data',
    blocks: [
      { id: 'line-items' as ElementType, label: 'Line Items Table', icon: 'LI' },
      { id: 'grouped-table' as ElementType, label: 'Grouped Table', icon: 'GT' },
      { id: 'qr-barcode' as ElementType, label: 'QR/Barcode', icon: 'QR' },
    ],
  },
  {
    name: 'Layout',
    blocks: [
      { id: 'watermark' as ElementType, label: 'Watermark', icon: 'Wm' },
    ],
  },
];

const PAGE_SIZES = ['A4', 'Letter', 'Legal', 'A3', 'A5'];
const ZOOM_LEVELS = [25, 50, 75, 100, 125, 150, 200];

const FONT_FAMILIES = ['Helvetica', 'Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'];

export default function ErpDesigner({
  templateId,
  templateName = 'Untitled Template',
  orgId,
  authToken,
  apiBase = '/api/pdfme',
  autoSaveInterval = 30000,
  onSave,
  onAssetUpload,
}: ErpDesignerProps) {
  const [activeTab, setActiveTab] = useState<LeftTab>('blocks');
  const [zoom, setZoom] = useState(100);
  const [pageSize, setPageSize] = useState('A4');
  const [name, setName] = useState(templateName);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showBindingPicker, setShowBindingPicker] = useState(false);
  const [bindingSearch, setBindingSearch] = useState('');
  const [fieldTabSearch, setFieldTabSearch] = useState('');

  // Auto-save state
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastAutoSave, setLastAutoSave] = useState<Date | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isDirtyRef = useRef(false);

  // Manual save state
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Render/PDF generation state
  const [renderStatus, setRenderStatus] = useState<'idle' | 'loading' | 'progress' | 'complete' | 'error'>('idle');
  const [renderProgress, setRenderProgress] = useState<{ completed: number; failed: number; total: number }>({ completed: 0, failed: 0, total: 0 });
  const [renderResult, setRenderResult] = useState<{ documentId?: string; downloadUrl?: string; batchId?: string; error?: string; jobId?: string } | null>(null);
  const [renderMessage, setRenderMessage] = useState('');
  const sseRef = useRef<EventSource | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Async render job status for display
  const [asyncJobStatus, setAsyncJobStatus] = useState<'queued' | 'generating' | 'done' | 'failed' | null>(null);

  // Template loading state
  const [isLoading, setIsLoading] = useState(!!templateId);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Publish state
  const [publishStatus, setPublishStatus] = useState<'idle' | 'publishing' | 'published' | 'error'>('idle');
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishErrors, setPublishErrors] = useState<Array<{ field: string; message: string; elementId?: string; pageIndex?: number }>>([]);

  // ─── Toast notification system with auto-dismiss ───
  interface ToastNotification {
    id: string;
    type: 'success' | 'error' | 'warning' | 'info';
    message: string;
    duration: number; // ms, 0 = no auto-dismiss
    createdAt: number;
  }
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const toastIdCounter = useRef(0);

  const addToast = useCallback((type: ToastNotification['type'], message: string, duration?: number) => {
    const defaultDuration = type === 'error' ? 8000 : type === 'warning' ? 6000 : 4000;
    const id = `toast-${++toastIdCounter.current}`;
    const toast: ToastNotification = { id, type, message, duration: duration ?? defaultDuration, createdAt: Date.now() };
    setToasts((prev) => [...prev, toast]);
    if (toast.duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, toast.duration);
    }
    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ─── Accessible status announcements (ARIA live regions) ───
  const [statusAnnouncement, setStatusAnnouncement] = useState('');
  const [errorAnnouncement, setErrorAnnouncement] = useState('');
  const announceStatus = useCallback((message: string) => {
    // Clear first to ensure re-announcement of same message
    setStatusAnnouncement('');
    requestAnimationFrame(() => setStatusAnnouncement(message));
  }, []);
  const announceError = useCallback((message: string) => {
    setErrorAnnouncement('');
    requestAnimationFrame(() => setErrorAnnouncement(message));
  }, []);

  // Preview mode state - substitutes binding placeholders with example values
  const [previewMode, setPreviewMode] = useState(false);

  // Asset management state
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [assetUploadStatus, setAssetUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [assetUploadError, setAssetUploadError] = useState<string | null>(null);
  const [assetUploadProgress, setAssetUploadProgress] = useState<number>(0);
  const assetFileInputRef = useRef<HTMLInputElement>(null);

  // ─── Font cache state ───
  const [fontCacheLoaded, setFontCacheLoaded] = useState(false);
  const [fontCacheEntries, setFontCacheEntries] = useState(0);
  const [fontCacheFromCache, setFontCacheFromCache] = useState<string[]>([]);
  const [fontCacheFromNetwork, setFontCacheFromNetwork] = useState<string[]>([]);

  // Template status (draft/published/archived) - shown in UI
  const [templateStatus, setTemplateStatus] = useState<'draft' | 'published' | 'archived' | null>(null);

  // Lock state - multi-tab editing protection
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [lockHolder, setLockHolder] = useState<string | null>(null);
  const [lockExpiresAt, setLockExpiresAt] = useState<string | null>(null);

  // Network connectivity / session recovery state
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [pendingRetrySave, setPendingRetrySave] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const reconnectRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRetryCountRef = useRef(0);
  const saveGenerationRef = useRef(0); // Tracks changes during save to prevent late responses overwriting
  const MAX_RECONNECT_RETRIES = 5;

  // ─── Responsive viewport state ───
  const NARROW_BREAKPOINT = 768;
  const [isNarrowViewport, setIsNarrowViewport] = useState(
    typeof window !== 'undefined' ? window.innerWidth <= NARROW_BREAKPOINT : false
  );
  const [mobilePanelOpen, setMobilePanelOpen] = useState<'left' | 'right' | null>(null);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);

  // ─── Focus trap refs for modal dialogs ───
  const shortcutsDialogRef = useRef<HTMLDivElement>(null);
  const renderDialogRef = useRef<HTMLDivElement>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);

  // ─── Focus trap effect for shortcuts dialog ───
  useEffect(() => {
    if (!showShortcutsHelp) return;
    lastFocusedElementRef.current = document.activeElement as HTMLElement;
    const dialogEl = shortcutsDialogRef.current;
    if (!dialogEl) return;
    const getFocusableElements = () => {
      return dialogEl.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
    };
    requestAnimationFrame(() => {
      const focusable = getFocusableElements();
      if (focusable.length > 0) focusable[0].focus();
    });
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowShortcutsHelp(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = getFocusableElements();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    dialogEl.addEventListener('keydown', handleKeyDown);
    return () => {
      dialogEl.removeEventListener('keydown', handleKeyDown);
      if (lastFocusedElementRef.current && lastFocusedElementRef.current.focus) {
        lastFocusedElementRef.current.focus();
      }
    };
  }, [showShortcutsHelp]);

  // ─── Focus trap effect for render dialog ───
  useEffect(() => {
    if (renderStatus === 'idle') return;
    const dialogEl = renderDialogRef.current;
    if (!dialogEl) return;
    const prevFocused = document.activeElement as HTMLElement;
    const getFocusableElements = () => {
      return dialogEl.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
    };
    requestAnimationFrame(() => {
      const focusable = getFocusableElements();
      if (focusable.length > 0) focusable[0].focus();
    });
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = getFocusableElements();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    dialogEl.addEventListener('keydown', handleKeyDown);
    return () => {
      dialogEl.removeEventListener('keydown', handleKeyDown);
      if (prevFocused && prevFocused.focus) { prevFocused.focus(); }
    };
  }, [renderStatus]);

  useEffect(() => {
    const handleResize = () => {
      const narrow = window.innerWidth <= NARROW_BREAKPOINT;
      setIsNarrowViewport(narrow);
      if (!narrow) {
        setMobilePanelOpen(null); // Close mobile drawers when going wide
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Keep isDirtyRef in sync with isDirty state
  // Increment save generation when dirty to detect changes during in-flight saves
  useEffect(() => {
    isDirtyRef.current = isDirty;
    if (isDirty) {
      saveGenerationRef.current += 1;
    }
  }, [isDirty]);

  // ─── Load template schema from API when templateId is provided ───
  useEffect(() => {
    if (!templateId) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();

    async function loadTemplate() {
      setIsLoading(true);
      setLoadError(null);
      // Reset state immediately to prevent stale data flash during rapid navigation
      setIsDirty(false);
      isDirtyRef.current = false;
      setSaveStatus('idle');
      setSaveError(null);
      setPublishStatus('idle');
      setPublishError(null);
      setZoom(100); // Reset zoom to default on new template load

      try {
        const headers: Record<string, string> = {};
        if (authToken) {
          headers['Authorization'] = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
        }

        const response = await fetch(`${apiBase}/templates/${templateId}`, { headers, signal: abortController.signal });

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
          throw new Error(errBody.message || `Failed to load template (${response.status})`);
        }

        const template = await response.json();
        if (cancelled) return;

        // Populate state from template data
        if (template.status) {
          setTemplateStatus(template.status);
        }
        if (template.name) {
          setName(template.name);
        }

        const schema = template.schema;
        if (schema) {
          // Set page size
          if (schema.pageSize) {
            setPageSize(schema.pageSize);
          }

          // Parse pages and elements from schema
          if (schema.pages && Array.isArray(schema.pages) && schema.pages.length > 0) {
            const loadedPages: TemplatePage[] = schema.pages.map((page: { id?: string; label?: string; elements?: DesignElement[] }, idx: number) => {
              const pageElements: DesignElement[] = (page.elements || []).map((el: Partial<DesignElement> & { id: string; type: ElementType }) => ({
                id: el.id || createElementId(),
                type: el.type || 'text',
                x: el.x ?? 50,
                y: el.y ?? 50,
                w: el.w ?? 100,
                h: el.h ?? 40,
                content: el.content,
                fontFamily: el.fontFamily,
                fontSize: el.fontSize,
                fontWeight: el.fontWeight,
                fontStyle: el.fontStyle,
                textAlign: el.textAlign,
                color: el.color,
                lineHeight: el.lineHeight,
                src: el.src,
                objectFit: el.objectFit,
                altText: el.altText,
                opacity: el.opacity,
                columns: el.columns,
                showHeader: el.showHeader,
                borderStyle: el.borderStyle,
                binding: el.binding,
              }));

              return {
                id: page.id || `page-loaded-${idx + 1}`,
                label: page.label || `Page ${idx + 1}`,
                elements: pageElements,
              };
            });

            setPages(loadedPages);
            setCurrentPageIndex(0);
            clearUndoHistory(); // Reset undo/redo on new template load
          }
        }

        // ─── Attempt to acquire edit lock ───
        try {
          const lockRes = await fetch(`${apiBase}/templates/${templateId}/lock`, {
            method: 'POST',
            headers,
          });

          if (lockRes.ok) {
            // Lock acquired successfully
            if (!cancelled) {
              setIsReadOnly(false);
              setLockHolder(null);
              setLockExpiresAt(null);
            }
          } else if (lockRes.status === 409) {
            // Locked by another user
            const lockData = await lockRes.json().catch(() => ({}));
            if (!cancelled) {
              setIsReadOnly(true);
              setLockHolder(lockData.lockedBy || 'another user');
              setLockExpiresAt(lockData.expiresAt || null);
            }
          }
        } catch {
          // Lock acquisition failed - check lock status as fallback
          try {
            const statusRes = await fetch(`${apiBase}/templates/${templateId}/lock`, { headers });
            if (statusRes.ok) {
              const statusData = await statusRes.json().catch(() => ({}));
              if (!cancelled && statusData.locked && statusData.lockedBy) {
                setIsReadOnly(true);
                setLockHolder(statusData.lockedBy);
                setLockExpiresAt(statusData.expiresAt || null);
              }
            }
          } catch {
            // Ignore - proceed without lock
          }
        }

        setIsLoading(false);
      } catch (err: unknown) {
        if (cancelled) return;
        // Abort errors are expected during rapid navigation - silently ignore
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : String(err);
        setLoadError(msg);
        setIsLoading(false);
      }
    }

    loadTemplate();

    return () => {
      cancelled = true;
      abortController.abort(); // Cancel in-flight fetch to prevent stale data
      // Release lock on unmount if we hold it
      if (templateId && !isReadOnly) {
        const headers: Record<string, string> = {};
        if (authToken) {
          headers['Authorization'] = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
        }
        fetch(`${apiBase}/templates/${templateId}/lock`, {
          method: 'DELETE',
          headers,
        }).catch(() => {});
      }
    };
  }, [templateId, authToken, apiBase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Multi-page state
  const [pages, setPages] = useState<TemplatePage[]>(() => [
    createPage('Page 1'),
    createPage('Page 2'),
    createPage('Page 3'),
  ]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  // ─── Undo/Redo history ───
  const MAX_UNDO_HISTORY = 50;
  const undoStackRef = useRef<TemplatePage[][]>([]);
  const redoStackRef = useRef<TemplatePage[][]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const isUndoRedoRef = useRef(false);

  /** Push current state to undo stack before a mutation */
  const pushUndoState = useCallback((currentPages: TemplatePage[]) => {
    if (isUndoRedoRef.current) return; // Don't push during undo/redo operations
    const snapshot = JSON.parse(JSON.stringify(currentPages));
    undoStackRef.current.push(snapshot);
    if (undoStackRef.current.length > MAX_UNDO_HISTORY) {
      undoStackRef.current.shift(); // Remove oldest entry
    }
    // Clear redo stack on new action
    redoStackRef.current = [];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(0);
  }, []);

  /** Wrap setPages to capture undo history */
  const setPagesWithHistory = useCallback((updater: React.SetStateAction<TemplatePage[]>) => {
    if (isUndoRedoRef.current) {
      // During undo/redo, just set pages directly without pushing to history
      setPages(updater);
      return;
    }
    // Push current state to undo stack before applying the update
    setPages((prevPages) => {
      pushUndoState(prevPages);
      if (typeof updater === 'function') {
        return updater(prevPages);
      }
      return updater;
    });
  }, [pushUndoState]);

  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const previousState = undoStackRef.current.pop()!;
    // Save current state to redo stack
    setPages((currentPages) => {
      redoStackRef.current.push(JSON.parse(JSON.stringify(currentPages)));
      return previousState;
    });
    isUndoRedoRef.current = true;
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    setIsDirty(true);
    // Reset flag after state update
    setTimeout(() => { isUndoRedoRef.current = false; }, 0);
  }, []);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const nextState = redoStackRef.current.pop()!;
    // Save current state to undo stack
    setPages((currentPages) => {
      undoStackRef.current.push(JSON.parse(JSON.stringify(currentPages)));
      return nextState;
    });
    isUndoRedoRef.current = true;
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    setIsDirty(true);
    // Reset flag after state update
    setTimeout(() => { isUndoRedoRef.current = false; }, 0);
  }, []);

  /** Clear undo/redo history (called on new template load) */
  const clearUndoHistory = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setUndoCount(0);
    setRedoCount(0);
  }, []);

  // Drag reorder state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    pageIndex: number;
  }>({ visible: false, x: 0, y: 0, pageIndex: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const currentPage = pages[currentPageIndex];

  // Find selected element from current page
  const selectedElement = useMemo(() => {
    if (!selectedElementId || !currentPage) return null;
    return currentPage.elements.find((el) => el.id === selectedElementId) || null;
  }, [selectedElementId, currentPage]);

  // Close context menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        contextMenu.visible &&
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [contextMenu.visible]);

  // ─── Element update helper ───
  const updateElement = useCallback((elementId: string, updates: Partial<DesignElement>) => {
    setPagesWithHistory((prev) => {
      const next = prev.map((page, idx) => {
        if (idx !== currentPageIndex) return page;
        return {
          ...page,
          elements: page.elements.map((el) =>
            el.id === elementId ? { ...el, ...updates } : el
          ),
        };
      });
      return next;
    });
    setIsDirty(true);
  }, [currentPageIndex, setPagesWithHistory]);

  // ─── Add element to canvas ───
  const addElementToCanvas = useCallback((type: ElementType, position?: { x: number; y: number }) => {
    const id = createElementId();
    const defaults = getDefaultElement(type);
    let x: number, y: number;
    if (position) {
      x = position.x;
      y = position.y;
    } else {
      // Offset slightly for each new element to avoid stacking
      const existingCount = currentPage?.elements.length || 0;
      const offset = existingCount * 20;
      x = defaults.x + offset;
      y = defaults.y + offset;
    }
    const newElement: DesignElement = {
      id,
      ...defaults,
      x,
      y,
      pageScope: 'all',
      outputChannel: 'both',
      conditionalVisibility: 'always',
    };
    setPagesWithHistory((prev) => {
      return prev.map((page, idx) => {
        if (idx !== currentPageIndex) return page;
        return { ...page, elements: [...page.elements, newElement] };
      });
    });
    setSelectedElementId(id);
    setIsDirty(true);
    return id;
  }, [currentPageIndex, currentPage, setPagesWithHistory]);

  // ─── Block drag start handler ───
  const handleBlockDragStart = useCallback((e: React.DragEvent, blockType: ElementType) => {
    e.dataTransfer.setData('application/x-erp-block-type', blockType);
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  // ─── Field drag start handler ───
  const handleFieldDragStart = useCallback((e: React.DragEvent, fieldKey: string) => {
    e.dataTransfer.setData('application/x-erp-field-key', fieldKey);
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  // ─── Canvas drop handler for blocks and fields ───
  const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleCanvasDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Calculate drop position relative to the canvas page
    const canvasPage = (e.currentTarget as HTMLElement).closest('[data-testid="canvas-page"]') || e.currentTarget;
    const rect = canvasPage.getBoundingClientRect();
    const scale = zoom / 100;
    const dropX = Math.max(0, Math.round((e.clientX - rect.left) / scale));
    const dropY = Math.max(0, Math.round((e.clientY - rect.top) / scale));

    const blockType = e.dataTransfer.getData('application/x-erp-block-type');
    const fieldKey = e.dataTransfer.getData('application/x-erp-field-key');

    if (blockType) {
      // Dropping a block from the Blocks tab
      addElementToCanvas(blockType as ElementType, { x: dropX, y: dropY });
    } else if (fieldKey) {
      // Dropping a field from the Fields tab
      const bindingSyntax = `{{${fieldKey}}}`;
      // Check if we dropped on an existing element
      const targetEl = (e.target as HTMLElement).closest('[data-element-type]');
      if (targetEl) {
        const elId = targetEl.getAttribute('data-testid')?.replace('canvas-element-', '');
        if (elId) {
          const el = currentPage?.elements.find((el) => el.id === elId);
          if (el && (getElementCategory(el.type) === 'text' || el.type === 'qr-barcode')) {
            updateElement(elId, { binding: bindingSyntax, content: bindingSyntax });
            setSelectedElementId(elId);
            return;
          }
        }
      }
      // No target element or incompatible type - create new text element with binding
      const newId = addElementToCanvas('text', { x: dropX, y: dropY });
      if (newId) {
        // Update the newly created element with the binding
        updateElement(newId, { binding: bindingSyntax, content: bindingSyntax });
      }
    }
  }, [zoom, addElementToCanvas, currentPage, updateElement]);

  const isSavingRef = useRef(false);
  const handleSave = useCallback(async () => {
    // Prevent double-click race condition
    if (isSavingRef.current) return;
    isSavingRef.current = true;

    // Capture save generation - if changes occur during save, this will differ
    const saveGen = saveGenerationRef.current;

    // Call external callback if provided
    if (onSave) {
      onSave({ name, pageSize, pages, schemas: [] });
    }

    // If we have a templateId and apiBase, persist to backend
    if (templateId) {
      setSaveStatus('saving');
      setSaveError(null);
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (authToken) headers['Authorization'] = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;

        const response = await fetch(`${apiBase}/templates/${templateId}/draft`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            name,
            schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize, pages },
          }),
        });

        if (response.ok) {
          setSaveStatus('saved');
          // Only clear dirty flag if no changes occurred during the save
          if (saveGenerationRef.current === saveGen) {
            setIsDirty(false);
            isDirtyRef.current = false;
          }
          addToast('success', 'Draft saved successfully', 3000);
          announceStatus('Draft saved successfully');
          // Replace current history entry to prevent re-submit on back button
          if (typeof window !== 'undefined') {
            window.history.replaceState({ saved: true, templateId }, '', window.location.href);
          }
          setTimeout(() => setSaveStatus((prev) => prev === 'saved' ? 'idle' : prev), 3000);
        } else {
          const errBody = await response.json().catch(() => ({ message: `Server error (${response.status})` }));
          const errorMsg = errBody.message || `Save failed with status ${response.status}`;
          setSaveStatus('error');
          setSaveError(errorMsg);
          addToast('error', errorMsg, 8000);
          announceError(`Save error: ${errorMsg}`);
          // DO NOT clear isDirty - unsaved changes preserved for retry
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error
          ? (err.message.includes('fetch') || err.message.includes('network') || err.message.includes('Failed')
            ? 'Network error — check your connection and try again'
            : err.message)
          : 'An unexpected error occurred while saving';
        setSaveStatus('error');
        setSaveError(errorMsg);
        addToast('error', errorMsg, 8000);
        announceError(`Save error: ${errorMsg}`);
        // DO NOT clear isDirty - unsaved changes preserved for retry
        // Flag for auto-retry on reconnection
        if (!navigator.onLine) setPendingRetrySave(true);
      } finally {
        isSavingRef.current = false;
      }
    } else {
      // No templateId - just clear dirty flag (local-only mode)
      setIsDirty(false);
      isSavingRef.current = false;
    }
  }, [name, pageSize, pages, onSave, templateId, authToken, apiBase, addToast, announceStatus, announceError]);

  // ─── Publish: publish template to backend ───
  const isPublishingRef = useRef(false);
  const handlePublish = useCallback(async () => {
    if (isPublishingRef.current) return; // Prevent double-click
    if (!templateId) {
      setPublishStatus('error');
      setPublishError('Cannot publish: no template ID');
      return;
    }

    isPublishingRef.current = true;
    setPublishStatus('publishing');
    setPublishError(null);
    setPublishErrors([]);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;

      const response = await fetch(`${apiBase}/templates/${templateId}/publish`, {
        method: 'POST',
        headers,
      });

      if (response.ok) {
        setPublishStatus('published');
        setTemplateStatus('published');
        addToast('success', 'Template published successfully', 4000);
        announceStatus('Template published successfully');
        setTimeout(() => setPublishStatus((prev) => prev === 'published' ? 'idle' : prev), 5000);
      } else {
        const errBody = await response.json().catch(() => ({ message: `Publish failed with status ${response.status}` }));

        if (response.status === 422 && errBody.details && Array.isArray(errBody.details)) {
          // Validation errors - enrich with elementId and pageIndex for clickable navigation
          const enrichedErrors = errBody.details.map((err: { field: string; message: string }) => {
            const enriched: { field: string; message: string; elementId?: string; pageIndex?: number } = { ...err };
            // Parse field path like "schema.pages[0].elements[1].content" to extract page and element
            const pageMatch = err.field.match(/pages\[(\d+)\]/);
            const elementMatch = err.field.match(/elements\[(\d+)\]/);
            if (pageMatch) {
              enriched.pageIndex = parseInt(pageMatch[1], 10);
            }
            if (elementMatch && enriched.pageIndex !== undefined) {
              const elIdx = parseInt(elementMatch[1], 10);
              const page = pages[enriched.pageIndex];
              if (page && page.elements[elIdx]) {
                enriched.elementId = page.elements[elIdx].id;
              }
            }
            return enriched;
          });
          setPublishStatus('error');
          setPublishError('Template validation failed');
          setPublishErrors(enrichedErrors);
          addToast('error', `Publish failed: ${enrichedErrors.length} validation error(s)`, 8000);
          announceError(`Publish failed: ${enrichedErrors.length} validation errors`);
        } else if (response.status === 409) {
          setPublishStatus('error');
          setPublishError(errBody.message || 'Template is locked by another user');
          addToast('error', errBody.message || 'Template is locked by another user', 8000);
          announceError(`Publish error: ${errBody.message || 'Template is locked by another user'}`);
        } else {
          const errorMsg = errBody.message || `Publish failed with status ${response.status}`;
          setPublishStatus('error');
          setPublishError(errorMsg);
          addToast('error', errorMsg, 8000);
          announceError(`Publish error: ${errorMsg}`);
        }
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error
        ? (err.message.includes('fetch') || err.message.includes('network') || err.message.includes('Failed')
          ? 'Network error — check your connection and try again'
          : err.message)
        : 'An unexpected error occurred while publishing';
      setPublishStatus('error');
      setPublishError(errorMsg);
      announceError(`Publish error: ${errorMsg}`);
    } finally {
      isPublishingRef.current = false;
    }
  }, [templateId, authToken, apiBase, pages, addToast, announceStatus, announceError]);

  // ─── Navigate to validation error element ───
  const handleValidationErrorClick = useCallback((err: { field: string; elementId?: string; pageIndex?: number }) => {
    if (err.pageIndex !== undefined) {
      setCurrentPageIndex(err.pageIndex);
    }
    if (err.elementId) {
      setSelectedElementId(err.elementId);
    }
  }, []);

  // ─── Archive: soft-delete template and navigate back to list ───
  const [archiveStatus, setArchiveStatus] = useState<'idle' | 'archiving' | 'archived' | 'error'>('idle');
  const handleArchive = useCallback(async () => {
    if (!templateId) return;

    const confirmed = window.confirm('Are you sure you want to archive this template? This action can be undone by an administrator.');
    if (!confirmed) return;

    setArchiveStatus('archiving');

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;

      const response = await fetch(`${apiBase}/templates/${templateId}`, {
        method: 'DELETE',
        headers,
      });

      if (response.ok) {
        setArchiveStatus('archived');
        setTemplateStatus('archived');
        addToast('success', 'Template archived successfully', 4000);

        // Navigate back to template list after a short delay
        setTimeout(() => {
          const params = new URLSearchParams(window.location.search);
          const navParams = new URLSearchParams();
          if (params.get('orgId')) navParams.set('orgId', params.get('orgId')!);
          if (params.get('authToken')) navParams.set('authToken', params.get('authToken')!);
          const url = `/templates${navParams.toString() ? `?${navParams.toString()}` : ''}`;
          window.location.href = url;
        }, 1500);
      } else {
        const errBody = await response.json().catch(() => ({ message: `Archive failed with status ${response.status}` }));
        const errorMsg = errBody.message || `Archive failed with status ${response.status}`;
        setArchiveStatus('error');
        addToast('error', errorMsg, 8000);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'An unexpected error occurred while archiving';
      setArchiveStatus('error');
      addToast('error', errorMsg, 8000);
    }
  }, [templateId, authToken, apiBase, addToast]);

  // ─── Auto-save: save draft to backend every 30 seconds ───
  const performAutoSave = useCallback(async () => {
    if (!isDirtyRef.current || !templateId || isReadOnly) return;

    const autoSaveGen = saveGenerationRef.current;
    setAutoSaveStatus('saving');
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;

      const response = await fetch(`${apiBase}/templates/${templateId}/draft`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          name,
          schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize, pages },
        }),
      });

      if (response.ok) {
        setAutoSaveStatus('saved');
        setLastAutoSave(new Date());
        // Only clear dirty flag if no changes occurred during the auto-save
        if (saveGenerationRef.current === autoSaveGen) {
          setIsDirty(false);
          isDirtyRef.current = false;
        }
        announceStatus('Auto-saved');
        // Reset status back to idle after 3 seconds
        setTimeout(() => setAutoSaveStatus((prev) => prev === 'saved' ? 'idle' : prev), 3000);
      } else {
        setAutoSaveStatus('error');
        announceError('Auto-save failed');
        // Flag for reconnection retry if network is down
        if (!navigator.onLine) setPendingRetrySave(true);
        setTimeout(() => setAutoSaveStatus((prev) => prev === 'error' ? 'idle' : prev), 5000);
      }
    } catch {
      setAutoSaveStatus('error');
      announceError('Auto-save failed');
      // Flag for reconnection retry - network likely down
      if (!navigator.onLine) setPendingRetrySave(true);
      setTimeout(() => setAutoSaveStatus((prev) => prev === 'error' ? 'idle' : prev), 5000);
    }
  }, [templateId, authToken, apiBase, name, pageSize, pages, announceStatus, announceError]);

  // Set up auto-save interval
  useEffect(() => {
    if (!templateId || autoSaveInterval <= 0) return;

    autoSaveTimerRef.current = setInterval(() => {
      performAutoSave();
    }, autoSaveInterval);

    return () => {
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [templateId, autoSaveInterval, performAutoSave]);

  // ─── Warn on navigation when there are unsaved changes ───
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current && templateId) {
        // Attempt to trigger auto-save before leaving
        performAutoSave();
        // Show browser's native "unsaved changes" dialog
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    // Also trigger auto-save when page becomes hidden (tab switch, navigation)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && isDirtyRef.current && templateId) {
        performAutoSave();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [templateId, performAutoSave]);

  // ─── Network connectivity detection & session recovery ───
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // If there are unsaved changes (dirty state or previous save error), retry auto-save
      if (isDirtyRef.current && templateId && !isReadOnly) {
        setPendingRetrySave(true);
        saveRetryCountRef.current = 0;
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      // Clear any pending retry timers
      if (reconnectRetryRef.current) {
        clearTimeout(reconnectRetryRef.current);
        reconnectRetryRef.current = null;
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (reconnectRetryRef.current) {
        clearTimeout(reconnectRetryRef.current);
        reconnectRetryRef.current = null;
      }
    };
  }, [templateId, isReadOnly]);

  // ─── Reconnection auto-save retry with exponential backoff ───
  useEffect(() => {
    if (!pendingRetrySave || !isOnline || !templateId || isReadOnly) return;

    const attemptRetrySave = async () => {
      if (!isDirtyRef.current) {
        // No longer dirty - no need to retry
        setPendingRetrySave(false);
        saveRetryCountRef.current = 0;
        return;
      }

      const retryGen = saveGenerationRef.current;
      setAutoSaveStatus('saving');
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (authToken) headers['Authorization'] = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;

        const response = await fetch(`${apiBase}/templates/${templateId}/draft`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            name,
            schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize, pages },
          }),
        });

        if (response.ok) {
          setAutoSaveStatus('saved');
          setLastAutoSave(new Date());
          // Only clear dirty if no new changes during retry save
          if (saveGenerationRef.current === retryGen) {
            setIsDirty(false);
            isDirtyRef.current = false;
          }
          setPendingRetrySave(false);
          saveRetryCountRef.current = 0;
          // Also clear manual save error if there was one
          if (saveStatus === 'error') {
            setSaveStatus('idle');
            setSaveError(null);
          }
          setTimeout(() => setAutoSaveStatus((prev) => prev === 'saved' ? 'idle' : prev), 3000);
        } else {
          throw new Error(`Server error (${response.status})`);
        }
      } catch {
        saveRetryCountRef.current += 1;
        if (saveRetryCountRef.current < MAX_RECONNECT_RETRIES && isOnline) {
          // Exponential backoff: 1s, 2s, 4s, 8s, 16s
          const delay = Math.min(1000 * Math.pow(2, saveRetryCountRef.current - 1), 16000);
          setAutoSaveStatus('error');
          reconnectRetryRef.current = setTimeout(() => {
            attemptRetrySave();
          }, delay);
        } else {
          // Exhausted retries
          setAutoSaveStatus('error');
          setPendingRetrySave(false);
          saveRetryCountRef.current = 0;
        }
      }
    };

    // Start first retry after a brief delay to let the connection stabilize
    reconnectRetryRef.current = setTimeout(attemptRetrySave, 500);

    return () => {
      if (reconnectRetryRef.current) {
        clearTimeout(reconnectRetryRef.current);
        reconnectRetryRef.current = null;
      }
    };
  }, [pendingRetrySave, isOnline, templateId, isReadOnly, authToken, apiBase, name, pageSize, pages, saveStatus]);

  // ─── Render / PDF generation handlers ───

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
    return headers;
  }, [authToken]);

  // ─── Load assets list from API ───
  const loadAssets = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (authToken) {
        headers['Authorization'] = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
      }

      const response = await fetch(`${apiBase}/assets`, { headers });
      if (response.ok) {
        const result = await response.json();
        if (result.data && Array.isArray(result.data)) {
          const assetList: AssetInfo[] = result.data.map((filePath: string, idx: number) => {
            const filename = filePath.split('/').pop() || filePath;
            const ext = filename.split('.').pop()?.toLowerCase() || '';
            const mimeMap: Record<string, string> = {
              png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
              svg: 'image/svg+xml', webp: 'image/webp', gif: 'image/gif',
            };
            return {
              id: `asset-${idx}-${filename}`,
              filename,
              path: filePath,
              mimeType: mimeMap[ext] || 'application/octet-stream',
              size: 0,
              uploadedAt: new Date().toISOString(),
            };
          });
          setAssets(assetList);
        }
      }
    } catch {
      // Silent fail on asset list load - not critical
    }
  }, [authToken, apiBase]);

  // Load assets on mount
  useEffect(() => {
    if (authToken) {
      loadAssets();
    }
  }, [loadAssets, authToken]);

  // ─── Font cache: load org fonts with Cache API caching ───
  useEffect(() => {
    if (!authToken || !apiBase) return;

    let cancelled = false;

    async function loadFontsWithCache() {
      try {
        // First prune expired entries
        await pruneExpiredFonts();

        const headers: Record<string, string> = {};
        if (authToken) {
          headers['Authorization'] = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
        }

        // Fetch font list from API
        const response = await fetch(`${apiBase}/fonts`, { headers });
        if (!response.ok || cancelled) return;

        const result = await response.json();
        const fontFiles: string[] = result.data || [];

        const fromCache: string[] = [];
        const fromNetwork: string[] = [];

        // Load each font via Cache API
        for (const fontPath of fontFiles) {
          if (cancelled) return;
          try {
            const fontUrl = `${apiBase}/assets/${encodeURIComponent(fontPath)}`;
            const fetchHeaders: Record<string, string> = {};
            if (authToken) {
              fetchHeaders['Authorization'] = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
            }

            const result = await fetchFontWithCache(fontUrl, { headers: fetchHeaders });
            if (result.fromCache) {
              fromCache.push(fontPath);
            } else {
              fromNetwork.push(fontPath);
            }
          } catch {
            // Skip individual font errors
          }
        }

        if (!cancelled) {
          setFontCacheFromCache(fromCache);
          setFontCacheFromNetwork(fromNetwork);

          // Update cache stats
          const stats = await getFontCacheStats();
          setFontCacheEntries(stats.entryCount);
          setFontCacheLoaded(true);
        }
      } catch {
        // Font caching is an optimization, not critical
        if (!cancelled) setFontCacheLoaded(true);
      }
    }

    loadFontsWithCache();
    return () => { cancelled = true; };
  }, [authToken, apiBase]);

  // ─── Asset upload handler ───
  const handleAssetUpload = useCallback(async (file: File) => {
    setAssetUploadStatus('uploading');
    setAssetUploadError(null);
    setAssetUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append('file', file);

      // Use XMLHttpRequest for upload progress tracking
      const result = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setAssetUploadProgress(pct);
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch {
              reject(new Error('Invalid server response'));
            }
          } else {
            try {
              const errBody = JSON.parse(xhr.responseText);
              reject(new Error(errBody.message || `Upload failed with status ${xhr.status}`));
            } catch {
              reject(new Error(`Upload failed (${xhr.status})`));
            }
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
        xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

        xhr.open('POST', `${apiBase}/assets/upload`);
        if (authToken) {
          xhr.setRequestHeader('Authorization', authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`);
        }
        xhr.send(formData);
      });

      const newAsset: AssetInfo = {
        id: result.id || result.assetId || `asset-${Date.now()}`,
        filename: result.filename || file.name,
        path: result.path || result.storagePath || '',
        mimeType: result.mimeType || file.type,
        size: result.size || file.size,
        uploadedAt: result.uploadedAt || new Date().toISOString(),
      };

      setAssets((prev) => [...prev, newAsset]);
      setAssetUploadProgress(100);
      setAssetUploadStatus('success');

      // Auto-dismiss success after 3 seconds
      setTimeout(() => {
        setAssetUploadStatus((prev) => prev === 'success' ? 'idle' : prev);
        setAssetUploadProgress(0);
      }, 3000);

      // Call the onAssetUpload callback if provided
      if (onAssetUpload) {
        onAssetUpload(newAsset);
      }

      return newAsset;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAssetUploadStatus('error');
      setAssetUploadError(msg);
      setAssetUploadProgress(0);
      setTimeout(() => {
        setAssetUploadStatus((prev) => prev === 'error' ? 'idle' : prev);
        setAssetUploadError(null);
      }, 5000);
      return null;
    }
  }, [authToken, apiBase, onAssetUpload]);

  const handleAssetFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleAssetUpload(file);
    }
    // Reset file input so same file can be selected again
    if (assetFileInputRef.current) {
      assetFileInputRef.current.value = '';
    }
  }, [handleAssetUpload]);

  /** Single PDF render (preview or render/now) */
  const handlePreview = useCallback(async () => {
    if (!templateId) {
      setRenderStatus('error');
      setRenderMessage('Save the template first to generate a preview');
      setRenderResult({ error: 'No template ID' });
      announceError('Save the template first to generate a preview');
      setTimeout(() => { if (renderStatus === 'error') { setRenderStatus('idle'); setRenderResult(null); setRenderMessage(''); } }, 5000);
      return;
    }

    setRenderStatus('loading');
    setRenderMessage('Generating preview PDF…');
    setRenderResult(null);
    setRenderProgress({ completed: 0, failed: 0, total: 1 });

    try {
      const response = await fetch(`${apiBase}/templates/${templateId}/preview`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ sampleRowCount: 5, channel: 'print' }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ message: 'Preview generation failed' }));
        throw new Error(errBody.message || `HTTP ${response.status}`);
      }

      const result = await response.json();
      setRenderStatus('complete');
      setRenderMessage('Preview ready!');
      setRenderResult({
        documentId: result.previewId,
        downloadUrl: result.downloadUrl || `${apiBase}/render/download/${result.previewId}`,
      });
      setRenderProgress({ completed: 1, failed: 0, total: 1 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRenderStatus('error');
      setRenderMessage(`Preview failed: ${msg}`);
      setRenderResult({ error: msg });
      announceError(`Preview failed: ${msg}`);
    }
  }, [templateId, apiBase, getAuthHeaders, renderStatus]);

  /** Single document render via render/now */
  const handleRenderNow = useCallback(async (entityId?: string) => {
    if (!templateId) {
      setRenderStatus('error');
      setRenderMessage('Save the template first');
      setRenderResult({ error: 'No template ID' });
      announceError('Save the template first');
      return;
    }

    setRenderStatus('loading');
    setRenderMessage('Generating PDF…');
    setRenderResult(null);
    setRenderProgress({ completed: 0, failed: 0, total: 1 });

    try {
      const response = await fetch(`${apiBase}/render/now`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          templateId,
          entityId: entityId || 'preview',
          channel: 'print',
        }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ message: 'Render failed' }));
        throw new Error(errBody.message || `HTTP ${response.status}`);
      }

      const result = await response.json();
      setRenderStatus('complete');
      setRenderMessage('PDF generated successfully!');
      setRenderResult({
        documentId: result.document?.id || result.documentId,
        downloadUrl: result.downloadUrl,
      });
      setRenderProgress({ completed: 1, failed: 0, total: 1 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRenderStatus('error');
      setRenderMessage(`Render failed: ${msg}`);
      setRenderResult({ error: msg });
      announceError(`Render failed: ${msg}`);
    }
  }, [templateId, apiBase, getAuthHeaders, announceError]);

  /** Bulk render with SSE progress tracking */
  const handleBulkRender = useCallback(async (entityIds: string[]) => {
    if (!templateId || entityIds.length === 0) return;

    // Cleanup any existing SSE connection
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }

    setRenderStatus('loading');
    setRenderMessage(`Starting bulk render of ${entityIds.length} documents…`);
    setRenderResult(null);
    setRenderProgress({ completed: 0, failed: 0, total: entityIds.length });

    try {
      const response = await fetch(`${apiBase}/render/bulk`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          templateId,
          entityIds,
          channel: 'print',
        }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ message: 'Bulk render failed' }));
        throw new Error(errBody.message || `HTTP ${response.status}`);
      }

      const result = await response.json();
      const batchId = result.batchId;

      setRenderStatus('progress');
      setRenderMessage(`Rendering ${entityIds.length} documents…`);
      setRenderResult({ batchId });

      // Connect to SSE progress stream
      const tokenParam = authToken ? `?token=${encodeURIComponent(authToken)}` : '';
      const eventSource = new EventSource(`${apiBase}/render/batch/${batchId}/progress${tokenParam}`);
      sseRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'job_complete' || data.type === 'job_completed' || data.type === 'job_failed') {
            const isComplete = data.type === 'job_complete' || data.type === 'job_completed';
            setRenderProgress((prev) => ({
              ...prev,
              completed: isComplete ? prev.completed + 1 : prev.completed,
              failed: data.type === 'job_failed' ? prev.failed + 1 : prev.failed,
            }));
            const done = (data.completedJobs || 0) + (data.failedJobs || 0);
            setRenderMessage(`Rendering: ${done}/${entityIds.length} complete`);
          }

          if (data.type === 'batch_complete') {
            setRenderStatus('complete');
            setRenderMessage(`Bulk render complete! ${data.completedJobs || 0} succeeded, ${data.failedJobs || 0} failed`);
            setRenderProgress({
              completed: data.completedJobs || 0,
              failed: data.failedJobs || 0,
              total: entityIds.length,
            });
            eventSource.close();
            sseRef.current = null;
          }
        } catch {
          // ignore parse errors
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        sseRef.current = null;
        // Only set error if we haven't completed
        setRenderStatus((prev) => {
          if (prev === 'complete') return prev;
          setRenderMessage('Lost connection to progress stream. Check batch status manually.');
          return 'error';
        });
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRenderStatus('error');
      setRenderMessage(`Bulk render failed: ${msg}`);
      setRenderResult({ error: msg });
    }
  }, [templateId, apiBase, authToken, getAuthHeaders]);

  /** Dismiss render overlay */
  const dismissRenderOverlay = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setRenderStatus('idle');
    setRenderMessage('');
    setRenderResult(null);
    setRenderProgress({ completed: 0, failed: 0, total: 0 });
    setAsyncJobStatus(null);
  }, []);

  /** Async render via queue with polling for status transitions */
  const handleAsyncRender = useCallback(async (entityId?: string) => {
    if (!templateId) {
      setRenderStatus('error');
      setRenderMessage('Save the template first');
      setRenderResult({ error: 'No template ID' });
      return;
    }

    // Clear any existing polling
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    setRenderStatus('loading');
    setRenderMessage('Submitting render job…');
    setRenderResult(null);
    setRenderProgress({ completed: 0, failed: 0, total: 1 });
    setAsyncJobStatus(null);

    try {
      // Submit async render job
      const response = await fetch(`${apiBase}/render/async`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          templateId,
          entityId: entityId || 'preview',
          channel: 'print',
        }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ message: 'Async render failed' }));
        throw new Error(errBody.message || `HTTP ${response.status}`);
      }

      const submitResult = await response.json();
      const jobId = submitResult.jobId;

      setRenderStatus('progress');
      setRenderMessage('Render job queued…');
      setRenderResult({ jobId });
      setAsyncJobStatus('queued');

      // Start polling for status
      const pollStatus = async () => {
        try {
          const statusResponse = await fetch(`${apiBase}/render/status/${jobId}`, {
            headers: getAuthHeaders(),
          });

          if (!statusResponse.ok) return;

          const statusData = await statusResponse.json();
          const newStatus = statusData.status as 'queued' | 'generating' | 'done' | 'failed';

          setAsyncJobStatus(newStatus);

          if (newStatus === 'queued') {
            setRenderMessage('Render job queued — waiting for worker…');
          } else if (newStatus === 'generating') {
            setRenderMessage('Generating PDF…');
          } else if (newStatus === 'done') {
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
            setRenderStatus('complete');
            setRenderMessage('PDF generated successfully!');
            setRenderResult({
              jobId,
              documentId: statusData.result?.documentId,
              downloadUrl: statusData.result?.filePath
                ? `${apiBase}/render/download/${statusData.result.documentId}`
                : undefined,
            });
            setRenderProgress({ completed: 1, failed: 0, total: 1 });
          } else if (newStatus === 'failed') {
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
            setRenderStatus('error');
            setRenderMessage(`Render failed: ${statusData.error || 'Unknown error'}`);
            setRenderResult({ jobId, error: statusData.error || 'Unknown error' });
          }
        } catch {
          // Polling failure - continue polling
        }
      };

      // Poll immediately, then every 1 second
      await pollStatus();
      pollingRef.current = setInterval(pollStatus, 1000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRenderStatus('error');
      setRenderMessage(`Async render failed: ${msg}`);
      setRenderResult({ error: msg });
    }
  }, [templateId, apiBase, getAuthHeaders]);

  // Cleanup SSE and polling on unmount
  useEffect(() => {
    return () => {
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  // ─── Keyboard shortcuts (undo/redo/delete/save/help) ───
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

      // Escape always works - close shortcuts help dialog
      if (e.key === 'Escape') {
        setShowShortcutsHelp(false);
        return;
      }

      // Ctrl+S always works (save) - even in inputs
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
        return;
      }

      // All other shortcuts require not being in an input
      if (isInput) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedElementId) {
          e.preventDefault();
          setPagesWithHistory((prev: TemplatePage[]) => prev.map((p: TemplatePage, idx: number) => idx !== currentPageIndex ? p : { ...p, elements: p.elements.filter((elem: DesignElement) => elem.id !== selectedElementId) }));
          setSelectedElementId(null);
          setIsDirty(true);
        }
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // Arrow keys nudge selected element: 1px default, 10px with Shift
        if (selectedElementId) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          updateElement(selectedElementId, {
            x: Math.max(0, (selectedElement?.x ?? 0) + dx),
            y: Math.max(0, (selectedElement?.y ?? 0) + dy),
          });
        }
      } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowShortcutsHelp((prev: boolean) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, handleSave, selectedElementId, selectedElement, currentPageIndex, setPagesWithHistory, setSelectedElementId, setIsDirty, updateElement]);

  // ─── Page management ───

  const addPage = useCallback(() => {
    setPagesWithHistory((prev) => {
      const newPage = createPage(`Page ${prev.length + 1}`);
      return [...prev, newPage];
    });
    setIsDirty(true);
  }, [setPagesWithHistory]);

  const duplicatePage = useCallback((index: number) => {
    setPagesWithHistory((prev) => {
      const source = prev[index];
      const dup: TemplatePage = {
        ...createPage(`${source.label} (Copy)`),
        elements: source.elements.map((el) => ({ ...el, id: createElementId() })),
      };
      const next = [...prev];
      next.splice(index + 1, 0, dup);
      return next;
    });
    setIsDirty(true);
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, [setPagesWithHistory]);

  const deletePage = useCallback((index: number) => {
    setPagesWithHistory((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== index);
      return next;
    });
    setCurrentPageIndex((prev) => {
      if (prev >= pages.length - 1) return Math.max(0, pages.length - 2);
      if (index <= prev) return Math.max(0, prev - 1);
      return prev;
    });
    setIsDirty(true);
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, [pages.length, setPagesWithHistory]);

  // ─── Drag handlers for page reorder ───

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    setPagesWithHistory((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(dropIndex, 0, moved);
      return next;
    });
    if (currentPageIndex === dragIndex) {
      setCurrentPageIndex(dropIndex);
    } else if (dragIndex < currentPageIndex && dropIndex >= currentPageIndex) {
      setCurrentPageIndex((prev) => prev - 1);
    } else if (dragIndex > currentPageIndex && dropIndex <= currentPageIndex) {
      setCurrentPageIndex((prev) => prev + 1);
    }
    setDragIndex(null);
    setDragOverIndex(null);
    setIsDirty(true);
  }, [dragIndex, currentPageIndex]);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
  }, []);

  // ─── Context menu handler ───

  const handleContextMenu = useCallback((e: React.MouseEvent, pageIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      pageIndex,
    });
  }, []);

  // ─── Data binding picker ───
  const handleBindField = useCallback((fieldKey: string) => {
    if (!selectedElementId) return;
    const bindingSyntax = `{{${fieldKey}}}`;
    updateElement(selectedElementId, { binding: bindingSyntax, content: bindingSyntax });
    setShowBindingPicker(false);
    setBindingSearch('');
  }, [selectedElementId, updateElement]);

  // Filtered data fields for binding search
  const filteredFields = useMemo(() => {
    if (!bindingSearch) return DATA_FIELDS;
    const q = bindingSearch.toLowerCase();
    return DATA_FIELDS.map((group) => ({
      ...group,
      fields: group.fields.filter(
        (f) => f.key.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)
      ),
    })).filter((g) => g.fields.length > 0);
  }, [bindingSearch]);

  // Filtered data fields for Fields tab search
  const filteredFieldTabFields = useMemo(() => {
    if (!fieldTabSearch) return DATA_FIELDS;
    const q = fieldTabSearch.toLowerCase();
    return DATA_FIELDS.map((group) => ({
      ...group,
      fields: group.fields.filter(
        (f) => f.key.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)
      ),
    })).filter((g) => g.fields.length > 0);
  }, [fieldTabSearch]);

  // ─── Element visual representation on canvas ───
  const renderCanvasElement = useCallback((el: DesignElement) => {
    const scale = zoom / 100;
    const isSelected = selectedElementId === el.id;
    const category = getElementCategory(el.type);

    const baseStyle: React.CSSProperties = {
      position: 'absolute',
      left: `${el.x * scale}px`,
      top: `${el.y * scale}px`,
      width: `${el.w * scale}px`,
      height: `${el.h * scale}px`,
      border: isSelected ? '2px solid #3b82f6' : '1px solid #cbd5e1',
      borderRadius: '2px',
      cursor: 'pointer',
      boxSizing: 'border-box',
      overflow: 'hidden',
      backgroundColor: category === 'image' ? '#f8fafc' : 'transparent',
      // Crisp rendering at all zoom levels
      backfaceVisibility: 'hidden',
      WebkitFontSmoothing: 'antialiased',
      willChange: 'transform',
      transform: 'translateZ(0)',
    } as React.CSSProperties;

    let content: React.ReactNode = null;
    if (category === 'text') {
      let displayText: string;
      if (previewMode) {
        // In preview mode, resolve bindings to example values
        const rawText = el.content || el.binding || el.type;
        displayText = resolveBindingToExample(rawText, el.binding);
      } else {
        displayText = el.binding ? `{{${el.binding}}}` : (el.content || el.type);
      }
      content = (
        <div
          style={{
            width: '100%',
            height: '100%',
            padding: `${2 * scale}px`,
            fontSize: `${(el.fontSize || 14) * scale}px`,
            fontFamily: el.fontFamily || 'Helvetica',
            fontWeight: el.fontWeight || 'normal',
            fontStyle: el.fontStyle || 'normal',
            textAlign: (el.textAlign as React.CSSProperties['textAlign']) || 'left',
            color: el.color || '#000',
            lineHeight: el.lineHeight || 1.4,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            userSelect: 'none',
            textRendering: 'optimizeLegibility',
          }}
        >
          {displayText}
        </div>
      );
    } else if (category === 'image') {
      content = (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#64748b',
            fontSize: `${12 * scale}px`,
            userSelect: 'none',
          }}
        >
          {el.src ? (
            <img src={el.src} alt={el.altText || ''} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: el.objectFit || 'contain', imageRendering: 'auto' }} />
          ) : (
            getElementTypeLabel(el.type)
          )}
        </div>
      );
    } else if (category === 'table') {
      content = (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            userSelect: 'none',
          }}
        >
          {el.showHeader && el.columns && (
            <div style={{ display: 'flex', borderBottom: `1px solid ${el.borderStyle === 'none' ? 'transparent' : '#cbd5e1'}`, fontSize: `${10 * scale}px`, fontWeight: 600, color: '#475569' }}>
              {el.columns.map((col) => (
                <div key={col.key} style={{ flex: col.width, padding: `${2 * scale}px ${4 * scale}px`, borderRight: `1px solid ${el.borderStyle === 'none' ? 'transparent' : '#e2e8f0'}` }}>
                  {col.header}
                </div>
              ))}
            </div>
          )}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: `${10 * scale}px` }}>
            {getElementTypeLabel(el.type)}
          </div>
        </div>
      );
    } else {
      content = (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: `${10 * scale}px`, userSelect: 'none' }}>
          {previewMode && el.binding ? resolveBindingToExample(el.binding, el.binding) : (el.binding ? `{{${el.binding}}}` : getElementTypeLabel(el.type))}
        </div>
      );
    }

    return (
      <div
        key={el.id}
        data-testid={`canvas-element-${el.id}`}
        data-element-type={el.type}
        role="button"
        tabIndex={0}
        aria-label={`${getElementTypeLabel(el.type)} element${el.binding ? ` bound to ${el.binding}` : ''}`}
        aria-selected={isSelected}
        style={baseStyle}
        onClick={(e) => {
          e.stopPropagation();
          setSelectedElementId(el.id);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setSelectedElementId(el.id); }
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            if (isSelected) {
              setPagesWithHistory((prev) => prev.map((p, idx) => idx !== currentPageIndex ? p : { ...p, elements: p.elements.filter((elem) => elem.id !== el.id) }));
              setSelectedElementId(null);
              setIsDirty(true);
            }
          }
        }}
      >
        {content}
        {/* Selection handles */}
        {isSelected && (
          <>
            <div style={{ position: 'absolute', top: -4, left: -4, width: 8, height: 8, backgroundColor: '#3b82f6', borderRadius: '50%', border: '1px solid white' }} />
            <div style={{ position: 'absolute', top: -4, right: -4, width: 8, height: 8, backgroundColor: '#3b82f6', borderRadius: '50%', border: '1px solid white' }} />
            <div style={{ position: 'absolute', bottom: -4, left: -4, width: 8, height: 8, backgroundColor: '#3b82f6', borderRadius: '50%', border: '1px solid white' }} />
            <div style={{ position: 'absolute', bottom: -4, right: -4, width: 8, height: 8, backgroundColor: '#3b82f6', borderRadius: '50%', border: '1px solid white' }} />
          </>
        )}
      </div>
    );
  }, [zoom, selectedElementId, previewMode]);

  // ─── Properties Panel Rendering ───

  const renderPropertiesPanel = () => {
    if (!selectedElement) {
      return (
        <div
          data-testid="properties-empty"
          role="status"
          aria-label="No element selected"
          style={{
            textAlign: 'center',
            color: '#64748b',
            fontSize: '13px',
            padding: '40px 20px',
          }}
        >
          Select an element on the canvas to edit its properties
        </div>
      );
    }

    const category = getElementCategory(selectedElement.type);

    return (
      <div data-testid="properties-content" data-element-type={selectedElement.type} role="region" aria-label={`${getElementTypeLabel(selectedElement.type)} element properties`}>
        {/* Element type header */}
        <div
          data-testid="properties-type-label"
          role="heading"
          aria-level={2}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '16px',
            padding: '8px',
            backgroundColor: '#f1f5f9',
            borderRadius: '6px',
          }}
        >
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#2563eb', textTransform: 'uppercase' }}>
            {getElementTypeLabel(selectedElement.type)}
          </span>
        </div>

        {/* Position & Size (always shown) */}
        <div style={{ marginBottom: '16px' }} data-testid="properties-position-size">
          <label style={labelStyle}>Position &amp; Size</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div>
              <label htmlFor="prop-x" style={{ fontSize: '11px', color: '#64748b' }}>X</label>
              <input
                id="prop-x"
                data-testid="prop-x"
                type="number"
                style={propInputStyle}
                value={selectedElement.x}
                onChange={(e) => updateElement(selectedElement.id, { x: Number(e.target.value) || 0 })}
              />
            </div>
            <div>
              <label htmlFor="prop-y" style={{ fontSize: '11px', color: '#64748b' }}>Y</label>
              <input
                id="prop-y"
                data-testid="prop-y"
                type="number"
                style={propInputStyle}
                value={selectedElement.y}
                onChange={(e) => updateElement(selectedElement.id, { y: Number(e.target.value) || 0 })}
              />
            </div>
            <div>
              <label htmlFor="prop-w" style={{ fontSize: '11px', color: '#64748b' }}>W</label>
              <input
                id="prop-w"
                data-testid="prop-w"
                type="number"
                style={propInputStyle}
                value={selectedElement.w}
                onChange={(e) => updateElement(selectedElement.id, { w: Number(e.target.value) || 1 })}
              />
            </div>
            <div>
              <label htmlFor="prop-h" style={{ fontSize: '11px', color: '#64748b' }}>H</label>
              <input
                id="prop-h"
                data-testid="prop-h"
                type="number"
                style={propInputStyle}
                value={selectedElement.h}
                onChange={(e) => updateElement(selectedElement.id, { h: Number(e.target.value) || 1 })}
              />
            </div>
          </div>
        </div>

        {/* Typography section - for text-like elements */}
        {category === 'text' && (
          <div data-testid="properties-typography" style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Typography</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>
                <label htmlFor="prop-font-family" style={{ fontSize: '11px', color: '#64748b' }}>Font Family</label>
                <select
                  id="prop-font-family"
                  data-testid="prop-font-family"
                  style={propInputStyle}
                  value={selectedElement.fontFamily || 'Helvetica'}
                  onChange={(e) => updateElement(selectedElement.id, { fontFamily: e.target.value })}
                >
                  {FONT_FAMILIES.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label htmlFor="prop-font-size" style={{ fontSize: '11px', color: '#64748b' }}>Font Size</label>
                  <input
                    id="prop-font-size"
                    data-testid="prop-font-size"
                    type="number"
                    style={propInputStyle}
                    value={selectedElement.fontSize || 14}
                    onChange={(e) => updateElement(selectedElement.id, { fontSize: Number(e.target.value) || 14 })}
                  />
                </div>
                <div>
                  <label htmlFor="prop-line-height" style={{ fontSize: '11px', color: '#64748b' }}>Line Height</label>
                  <input
                    id="prop-line-height"
                    data-testid="prop-line-height"
                    type="number"
                    step="0.1"
                    style={propInputStyle}
                    value={selectedElement.lineHeight || 1.4}
                    onChange={(e) => updateElement(selectedElement.id, { lineHeight: Number(e.target.value) || 1.4 })}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  data-testid="prop-bold"
                  aria-label="Toggle bold"
                  style={{
                    ...toolbarBtnStyle,
                    fontWeight: 700,
                    backgroundColor: selectedElement.fontWeight === 'bold' ? '#e0e7ff' : '#f8fafc',
                    color: selectedElement.fontWeight === 'bold' ? '#2563eb' : '#334155',
                    flex: 1,
                  }}
                  onClick={() => updateElement(selectedElement.id, { fontWeight: selectedElement.fontWeight === 'bold' ? 'normal' : 'bold' })}
                >
                  B
                </button>
                <button
                  data-testid="prop-italic"
                  aria-label="Toggle italic"
                  style={{
                    ...toolbarBtnStyle,
                    fontStyle: 'italic',
                    backgroundColor: selectedElement.fontStyle === 'italic' ? '#e0e7ff' : '#f8fafc',
                    color: selectedElement.fontStyle === 'italic' ? '#2563eb' : '#334155',
                    flex: 1,
                  }}
                  onClick={() => updateElement(selectedElement.id, { fontStyle: selectedElement.fontStyle === 'italic' ? 'normal' : 'italic' })}
                >
                  I
                </button>
                {(['left', 'center', 'right'] as const).map((align) => (
                  <button
                    key={align}
                    data-testid={`prop-align-${align}`}
                    aria-label={`Align ${align}`}
                    style={{
                      ...toolbarBtnStyle,
                      backgroundColor: selectedElement.textAlign === align ? '#e0e7ff' : '#f8fafc',
                      color: selectedElement.textAlign === align ? '#2563eb' : '#334155',
                      flex: 1,
                      fontSize: '11px',
                    }}
                    onClick={() => updateElement(selectedElement.id, { textAlign: align })}
                  >
                    {align === 'left' ? 'L' : align === 'center' ? 'C' : 'R'}
                  </button>
                ))}
              </div>
              <div>
                <label htmlFor="prop-color" style={{ fontSize: '11px', color: '#64748b' }}>Color</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    id="prop-color"
                    data-testid="prop-color"
                    type="color"
                    style={{ width: '32px', height: '28px', border: '1px solid #e2e8f0', borderRadius: '4px', cursor: 'pointer', padding: 0 }}
                    value={selectedElement.color || '#000000'}
                    onChange={(e) => updateElement(selectedElement.id, { color: e.target.value })}
                  />
                  <input
                    id="prop-color-hex"
                    data-testid="prop-color-hex"
                    type="text"
                    aria-label="Text color hex value"
                    style={{ ...propInputStyle, flex: 1 }}
                    value={selectedElement.color || '#000000'}
                    onChange={(e) => updateElement(selectedElement.id, { color: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="prop-content" style={{ fontSize: '11px', color: '#64748b' }}>Content</label>
                <textarea
                  id="prop-content"
                  data-testid="prop-content"
                  style={{ ...propInputStyle, minHeight: '48px', resize: 'vertical' }}
                  value={selectedElement.content || ''}
                  onChange={(e) => updateElement(selectedElement.id, { content: e.target.value })}
                />
              </div>
            </div>
          </div>
        )}

        {/* Text Overflow - for text-like elements */}
        {category === 'text' && (
          <div data-testid="properties-text-overflow" style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Text Overflow</label>
            <div>
              <label htmlFor="prop-text-overflow" style={{ fontSize: '11px', color: '#64748b' }}>Overflow Strategy</label>
              <select
                id="prop-text-overflow"
                data-testid="prop-text-overflow"
                style={propInputStyle}
                value={selectedElement.textOverflow || 'clip'}
                onChange={(e) => updateElement(selectedElement.id, { textOverflow: e.target.value as DesignElement['textOverflow'] })}
              >
                <option value="clip">Clip (hide overflow)</option>
                <option value="truncate">Truncate with ellipsis</option>
                <option value="shrinkToFit">Shrink to fit</option>
              </select>
            </div>
          </div>
        )}

        {/* Image options - for image-like elements */}
        {category === 'image' && (
          <div data-testid="properties-image" style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Image Options</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>
                <label htmlFor="prop-src" style={{ fontSize: '11px', color: '#64748b' }}>Source URL</label>
                <input
                  id="prop-src"
                  data-testid="prop-src"
                  type="text"
                  style={propInputStyle}
                  placeholder="Image URL or asset reference"
                  value={selectedElement.src || ''}
                  onChange={(e) => updateElement(selectedElement.id, { src: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="prop-object-fit" style={{ fontSize: '11px', color: '#64748b' }}>Object Fit</label>
                <select
                  id="prop-object-fit"
                  data-testid="prop-object-fit"
                  style={propInputStyle}
                  value={selectedElement.objectFit || 'contain'}
                  onChange={(e) => updateElement(selectedElement.id, { objectFit: e.target.value as 'contain' | 'cover' | 'fill' })}
                >
                  <option value="contain">Contain</option>
                  <option value="cover">Cover</option>
                  <option value="fill">Fill</option>
                </select>
              </div>
              <div>
                <label htmlFor="prop-opacity" style={{ fontSize: '11px', color: '#64748b' }}>Opacity (%)</label>
                <input
                  id="prop-opacity"
                  data-testid="prop-opacity"
                  type="number"
                  min="0"
                  max="100"
                  style={propInputStyle}
                  value={selectedElement.opacity ?? 100}
                  onChange={(e) => updateElement(selectedElement.id, { opacity: Number(e.target.value) })}
                />
              </div>
              <div>
                <label htmlFor="prop-alt-text" style={{ fontSize: '11px', color: '#64748b' }}>Alt Text (Accessibility)</label>
                <input
                  id="prop-alt-text"
                  data-testid="prop-alt-text"
                  type="text"
                  style={propInputStyle}
                  placeholder="Describe this image for screen readers"
                  value={selectedElement.altText || ''}
                  onChange={(e) => updateElement(selectedElement.id, { altText: e.target.value })}
                />
                <span style={{ fontSize: '10px', color: '#64748b', display: 'block', marginTop: '2px' }}>
                  Used in PDF/UA output for accessibility compliance
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Table column config - for table elements */}
        {category === 'table' && (
          <div data-testid="properties-table" style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Table Configuration</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  id="prop-show-header"
                  data-testid="prop-show-header"
                  type="checkbox"
                  checked={selectedElement.showHeader ?? true}
                  onChange={(e) => updateElement(selectedElement.id, { showHeader: e.target.checked })}
                />
                <label htmlFor="prop-show-header" style={{ fontSize: '13px', color: '#334155' }}>Show Header Row</label>
              </div>
              <div>
                <label htmlFor="prop-border-style" style={{ fontSize: '11px', color: '#64748b' }}>Border Style</label>
                <select
                  id="prop-border-style"
                  data-testid="prop-border-style"
                  style={propInputStyle}
                  value={selectedElement.borderStyle || 'solid'}
                  onChange={(e) => updateElement(selectedElement.id, { borderStyle: e.target.value as 'solid' | 'dashed' | 'none' })}
                >
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="none">None</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Columns</label>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                  {(selectedElement.columns || []).map((col, colIdx) => (
                    <div
                      key={colIdx}
                      data-testid={`prop-column-${colIdx}`}
                      style={{
                        display: 'flex',
                        gap: '4px',
                        padding: '4px 6px',
                        borderBottom: colIdx < (selectedElement.columns?.length || 0) - 1 ? '1px solid #f1f5f9' : 'none',
                        alignItems: 'center',
                      }}
                    >
                      <input
                        data-testid={`prop-col-key-${colIdx}`}
                        type="text"
                        aria-label={`Column ${colIdx + 1} key`}
                        style={{ ...propInputStyle, flex: 1 }}
                        value={col.key}
                        placeholder="Key"
                        onChange={(e) => {
                          const newCols = [...(selectedElement.columns || [])];
                          newCols[colIdx] = { ...newCols[colIdx], key: e.target.value };
                          updateElement(selectedElement.id, { columns: newCols });
                        }}
                      />
                      <input
                        data-testid={`prop-col-header-${colIdx}`}
                        type="text"
                        aria-label={`Column ${colIdx + 1} header`}
                        style={{ ...propInputStyle, flex: 1 }}
                        value={col.header}
                        placeholder="Header"
                        onChange={(e) => {
                          const newCols = [...(selectedElement.columns || [])];
                          newCols[colIdx] = { ...newCols[colIdx], header: e.target.value };
                          updateElement(selectedElement.id, { columns: newCols });
                        }}
                      />
                      <input
                        data-testid={`prop-col-width-${colIdx}`}
                        type="number"
                        aria-label={`Column ${colIdx + 1} width`}
                        style={{ ...propInputStyle, width: '50px' }}
                        value={col.width}
                        onChange={(e) => {
                          const newCols = [...(selectedElement.columns || [])];
                          newCols[colIdx] = { ...newCols[colIdx], width: Number(e.target.value) || 60 };
                          updateElement(selectedElement.id, { columns: newCols });
                        }}
                      />
                    </div>
                  ))}
                </div>
                <button
                  data-testid="prop-add-column"
                  aria-label="Add table column"
                  style={{ ...toolbarBtnStyle, width: '100%', marginTop: '4px', fontSize: '11px' }}
                  onClick={() => {
                    const newCols = [...(selectedElement.columns || []), { key: `col${(selectedElement.columns?.length || 0) + 1}`, header: `Column ${(selectedElement.columns?.length || 0) + 1}`, width: 80 }];
                    updateElement(selectedElement.id, { columns: newCols });
                  }}
                >
                  + Add Column
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Data Binding section - for text and calculated elements */}
        {(category === 'text' || selectedElement.type === 'qr-barcode') && (
          <div data-testid="properties-binding" style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Data Binding</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>
                <label htmlFor="prop-binding" style={{ fontSize: '11px', color: '#64748b' }}>Bound Field</label>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <input
                    id="prop-binding"
                    data-testid="prop-binding"
                    type="text"
                    style={{ ...propInputStyle, flex: 1 }}
                    placeholder="e.g. {{customer.name}}"
                    value={selectedElement.binding || ''}
                    onChange={(e) => updateElement(selectedElement.id, { binding: e.target.value })}
                  />
                  <button
                    data-testid="btn-open-binding-picker"
                    aria-label="Open binding picker"
                    style={{ ...toolbarBtnStyle, padding: '4px 8px', fontSize: '11px' }}
                    onClick={() => setShowBindingPicker(!showBindingPicker)}
                  >
                    Pick
                  </button>
                </div>
              </div>

              {/* Binding field picker dropdown */}
              {showBindingPicker && (
                <div
                  data-testid="binding-picker"
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    backgroundColor: '#fff',
                    maxHeight: '250px',
                    overflow: 'auto',
                  }}
                >
                  <div style={{ padding: '6px', borderBottom: '1px solid #e2e8f0' }}>
                    <input
                      data-testid="binding-search"
                      type="text"
                      style={{ ...propInputStyle, width: '100%' }}
                      placeholder="Search fields..."
                      value={bindingSearch}
                      onChange={(e) => setBindingSearch(e.target.value)}
                      autoFocus
                    />
                  </div>
                  {filteredFields.map((group) => (
                    <div key={group.group}>
                      <div style={{ padding: '6px 8px', fontSize: '11px', fontWeight: 600, color: '#64748b', backgroundColor: '#f8fafc', textTransform: 'uppercase' }}>
                        {group.group}
                      </div>
                      {group.fields.map((field) => (
                        <div
                          key={field.key}
                          data-testid={`binding-field-${field.key}`}
                          style={{
                            padding: '6px 12px',
                            cursor: 'pointer',
                            fontSize: '12px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                          onClick={() => handleBindField(field.key)}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                          <span style={{ color: '#334155' }}>{field.label}</span>
                          <span data-testid={`binding-preview-${field.key}`} style={{ color: '#64748b', fontSize: '11px' }}>{field.example}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* Preview of bound value */}
              {selectedElement.binding && (
                <div data-testid="binding-preview-value" style={{ padding: '6px 8px', backgroundColor: '#f0fdf4', borderRadius: '4px', fontSize: '12px' }}>
                  <span style={{ color: '#64748b' }}>Preview: </span>
                  <span style={{ color: '#15803d', fontWeight: 500 }}>
                    {(() => {
                      const match = selectedElement.binding.match(/^\{\{(.+)\}\}$/);
                      if (!match) return selectedElement.binding;
                      const key = match[1];
                      for (const group of DATA_FIELDS) {
                        const field = group.fields.find((f) => f.key === key);
                        if (field) return field.example;
                      }
                      return selectedElement.binding;
                    })()}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Page Visibility section - always shown */}
        <div data-testid="properties-page-visibility" style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>Page Visibility</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div>
              <label htmlFor="prop-page-scope" style={{ fontSize: '11px', color: '#64748b' }}>Page Scope</label>
              <select
                id="prop-page-scope"
                data-testid="prop-page-scope"
                style={propInputStyle}
                value={selectedElement.pageScope || 'all'}
                onChange={(e) => updateElement(selectedElement.id, { pageScope: e.target.value as DesignElement['pageScope'] })}
              >
                <option value="all">All Pages</option>
                <option value="first">First Page Only</option>
                <option value="last">Last Page Only</option>
                <option value="notFirst">Not First Page</option>
              </select>
            </div>
            {selectedElement.pageScope && selectedElement.pageScope !== 'all' && (
              <div
                data-testid="page-scope-badge"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  backgroundColor: '#dbeafe',
                  color: '#1e40af',
                  fontSize: '11px',
                  fontWeight: 500,
                  width: 'fit-content',
                }}
              >
                {selectedElement.pageScope === 'first' && 'First page only'}
                {selectedElement.pageScope === 'last' && 'Last page only'}
                {selectedElement.pageScope === 'notFirst' && 'Not first page'}
              </div>
            )}
          </div>
        </div>

        {/* Output Channel section - always shown */}
        <div data-testid="properties-output-channel" style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>Output Channel</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div>
              <label htmlFor="prop-output-channel" style={{ fontSize: '11px', color: '#64748b' }}>Channel</label>
              <select
                id="prop-output-channel"
                data-testid="prop-output-channel"
                style={propInputStyle}
                value={selectedElement.outputChannel || 'both'}
                onChange={(e) => updateElement(selectedElement.id, { outputChannel: e.target.value as DesignElement['outputChannel'] })}
              >
                <option value="both">Both (Email &amp; Print)</option>
                <option value="email">Email Only</option>
                <option value="print">Print Only</option>
              </select>
            </div>
            {selectedElement.outputChannel && selectedElement.outputChannel !== 'both' && (
              <div
                data-testid="output-channel-badge"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  backgroundColor: '#fef3c7',
                  color: '#92400e',
                  fontSize: '11px',
                  fontWeight: 500,
                  width: 'fit-content',
                }}
              >
                {selectedElement.outputChannel === 'email' && 'Email only'}
                {selectedElement.outputChannel === 'print' && 'Print only'}
              </div>
            )}
          </div>
        </div>

        {/* Conditional Visibility section - always shown */}
        <div data-testid="properties-conditional-visibility" style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>Conditional Visibility</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div>
              <label htmlFor="prop-conditional-visibility" style={{ fontSize: '11px', color: '#64748b' }}>Visibility</label>
              <select
                id="prop-conditional-visibility"
                data-testid="prop-conditional-visibility"
                style={propInputStyle}
                value={selectedElement.conditionalVisibility || 'always'}
                onChange={(e) => updateElement(selectedElement.id, { conditionalVisibility: e.target.value as DesignElement['conditionalVisibility'], visibilityCondition: e.target.value === 'always' ? '' : selectedElement.visibilityCondition })}
              >
                <option value="always">Always Visible</option>
                <option value="conditional">Conditional</option>
              </select>
            </div>
            {selectedElement.conditionalVisibility === 'conditional' && (
              <div>
                <label htmlFor="prop-visibility-condition" style={{ fontSize: '11px', color: '#64748b' }}>Condition Expression</label>
                <input
                  id="prop-visibility-condition"
                  data-testid="prop-visibility-condition"
                  type="text"
                  style={propInputStyle}
                  value={selectedElement.visibilityCondition || ''}
                  onChange={(e) => updateElement(selectedElement.id, { visibilityCondition: e.target.value })}
                  placeholder="e.g. {{document.total}} > 0"
                />
              </div>
            )}
            {selectedElement.conditionalVisibility === 'conditional' && (
              <div
                data-testid="conditional-visibility-badge"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  backgroundColor: '#f3e8ff',
                  color: '#7c3aed',
                  fontSize: '11px',
                  fontWeight: 500,
                  width: 'fit-content',
                }}
              >
                ⚡ Conditional
              </div>
            )}
          </div>
        </div>

        {/* Delete element button */}
        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
          <button
            data-testid="btn-delete-element"
            aria-label="Delete element"
            style={{
              ...toolbarBtnStyle,
              width: '100%',
              color: '#dc2626',
              borderColor: '#fecaca',
              backgroundColor: '#fef2f2',
            }}
            onClick={() => {
              setPagesWithHistory((prev) => prev.map((page, idx) => {
                if (idx !== currentPageIndex) return page;
                return { ...page, elements: page.elements.filter((el) => el.id !== selectedElementId) };
              }));
              setSelectedElementId(null);
              setIsDirty(true);
            }}
          >
            Delete Element
          </button>
        </div>
      </div>
    );
  };

  // ─── Loading state: show spinner while fetching template from API ───
  if (isLoading) {
    return (
      <div
        data-testid="designer-loading"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          color: '#6b7280',
          backgroundColor: '#f8f9fa',
          gap: '16px',
        }}
      >
        <div style={{
          width: '40px',
          height: '40px',
          border: '3px solid #e5e7eb',
          borderTopColor: '#3b82f6',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ fontSize: '16px', fontWeight: 500 }}>Loading template...</div>
      </div>
    );
  }

  // ─── Load error state ───
  if (loadError) {
    return (
      <div
        data-testid="designer-load-error"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          color: '#dc2626',
          backgroundColor: '#f8f9fa',
          gap: '16px',
        }}
      >
        <div style={{ fontSize: '48px' }}>!</div>
        <div style={{ fontSize: '16px', fontWeight: 500 }}>Failed to load template</div>
        <div style={{ fontSize: '14px', color: '#6b7280', maxWidth: '400px', textAlign: 'center' }}>{loadError}</div>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '8px 16px',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            background: '#fff',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
    <style>{`
      @keyframes spin { to { transform: rotate(360deg); } }

      /* ─── Focus ring styles for accessibility (Feature #307) ─── */
      /* Toolbar buttons */
      .erp-designer-toolbar button:focus-visible,
      .erp-designer-toolbar select:focus-visible,
      .erp-designer-toolbar input:focus-visible {
        outline: 2px solid #4f46e5 !important;
        outline-offset: 2px !important;
        border-radius: 3px;
      }
      /* Properties panel inputs and selects */
      .erp-designer-right-panel input:focus-visible,
      .erp-designer-right-panel select:focus-visible,
      .erp-designer-right-panel button:focus-visible,
      .erp-designer-right-panel textarea:focus-visible {
        outline: 2px solid #4f46e5 !important;
        outline-offset: 1px !important;
        border-radius: 3px;
      }
      /* Left panel interactive elements - block cards, field items, page thumbnails */
      .erp-designer-left-panel button:focus-visible,
      .erp-designer-left-panel input:focus-visible,
      .erp-designer-left-panel select:focus-visible,
      .block-card:focus-visible,
      [role="option"]:focus-visible,
      [role="tab"]:focus-visible {
        outline: 2px solid #4f46e5 !important;
        outline-offset: 2px !important;
        border-radius: 4px;
      }
      /* Canvas elements */
      .erp-designer-canvas [tabindex="0"]:focus-visible {
        outline: 2px solid #4f46e5 !important;
        outline-offset: 1px !important;
        border-radius: 2px;
      }
      /* General fallback for any focusable elements in the designer */
      .erp-designer button:focus-visible,
      .erp-designer [role="button"]:focus-visible {
        outline: 2px solid #4f46e5 !important;
        outline-offset: 2px !important;
        border-radius: 3px;
      }
      /* Tab buttons in left panel */
      .erp-designer-left-panel [data-testid]:focus-visible {
        outline: 2px solid #4f46e5 !important;
        outline-offset: 2px !important;
      }
      /* Ensure no outline on mouse click (focus-visible only triggers on keyboard) */
      .erp-designer *:focus:not(:focus-visible) {
        outline: none;
      }
      /* Clickable validation errors */
      .erp-designer [data-element-id]:focus-visible {
        outline: 2px solid #4f46e5 !important;
        outline-offset: 1px !important;
        border-radius: 3px;
      }
      /* Toast close buttons */
      .erp-designer .toast-close-btn:focus-visible {
        outline: 2px solid #ffffff !important;
        outline-offset: 1px !important;
        border-radius: 2px;
      }

      .block-card {
        transition: background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .block-card:hover {
        background-color: #eef2ff !important;
        border-color: #c7d2fe !important;
        box-shadow: 0 1px 3px rgba(99,102,241,0.1);
      }
      .block-card:active {
        background-color: #e0e7ff !important;
        border-color: #a5b4fc !important;
      }
      @media (max-width: 1200px) and (min-width: 769px) {
        .erp-designer-left-panel {
          width: 220px !important;
        }
        .erp-designer-right-panel {
          width: 240px !important;
        }
        .erp-designer-canvas {
          padding: 16px !important;
        }
        .erp-designer-toolbar {
          gap: 8px !important;
          padding: 6px 12px !important;
        }
        .erp-designer-toolbar select,
        .erp-designer-toolbar input {
          max-width: 140px;
        }
      }
      @media (max-width: 768px) {
        .erp-designer-toolbar {
          flex-wrap: wrap !important;
          gap: 6px !important;
          padding: 6px 8px !important;
          min-height: auto !important;
        }
        .erp-designer-toolbar > * {
          flex-shrink: 1;
        }
        .erp-designer-toolbar select,
        .erp-designer-toolbar input {
          max-width: 120px;
        }
        .erp-designer-panels {
          position: relative;
        }
        .erp-designer-left-panel,
        .erp-designer-right-panel {
          position: absolute !important;
          top: 0 !important;
          bottom: 0 !important;
          z-index: 100 !important;
          box-shadow: 2px 0 12px rgba(0,0,0,0.15) !important;
          transition: transform 0.2s ease !important;
        }
        .erp-designer-left-panel {
          left: 0 !important;
        }
        .erp-designer-right-panel {
          right: 0 !important;
          box-shadow: -2px 0 12px rgba(0,0,0,0.15) !important;
        }
        .erp-designer-left-panel.panel-hidden {
          transform: translateX(-100%) !important;
        }
        .erp-designer-right-panel.panel-hidden {
          transform: translateX(100%) !important;
        }
        .erp-designer-canvas {
          padding: 8px !important;
        }
        .erp-designer {
          overflow-x: hidden !important;
        }
      }
    `}</style>
    <div
      className="erp-designer"
      data-testid="erp-designer-root"
      data-font-cache-loaded={fontCacheLoaded ? 'true' : 'false'}
      data-font-cache-entries={String(fontCacheEntries)}
      data-font-cache-available={isCacheApiAvailable() ? 'true' : 'false'}
      data-font-cache-from-cache={fontCacheFromCache.join(',')}
      data-font-cache-from-network={fontCacheFromNetwork.join(',')}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        maxWidth: '100vw',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#1a1a2e',
        backgroundColor: '#f8f9fa',
      }}
    >
      {/* ─── Read-only lock warning banner ─── */}
      {isReadOnly && (
        <div
          data-testid="lock-warning-banner"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 16px',
            backgroundColor: '#fef3c7',
            borderBottom: '1px solid #f59e0b',
            color: '#92400e',
            fontSize: '13px',
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '16px' }}>🔒</span>
          <span data-testid="lock-warning-message">
            This template is currently being edited by <strong data-testid="lock-holder">{lockHolder}</strong>.
            You are viewing in <strong>read-only mode</strong>.
          </span>
          {lockExpiresAt && (
            <span data-testid="lock-expires-at" style={{ marginLeft: 'auto', fontSize: '12px', color: '#b45309' }}>
              Lock expires: {new Date(lockExpiresAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      )}
      {/* ─── Toolbar ─── */}
      <div
        className="erp-designer-toolbar"
        data-testid="designer-toolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'nowrap',
          gap: '8px 12px',
          padding: '8px 16px',
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          minHeight: '48px',
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        {/* Back to Templates */}
        <button
          data-testid="btn-back-to-templates"
          onClick={() => {
            if (isDirty) {
              const confirmed = window.confirm('You have unsaved changes. Leave without saving?');
              if (!confirmed) return;
            }
            const params = new URLSearchParams(window.location.search);
            const navParams = new URLSearchParams();
            if (params.get('orgId')) navParams.set('orgId', params.get('orgId')!);
            if (params.get('authToken')) navParams.set('authToken', params.get('authToken')!);
            const url = `/templates${navParams.toString() ? `?${navParams.toString()}` : ''}`;
            window.location.href = url;
          }}
          style={{
            padding: '4px 8px',
            borderRadius: '4px',
            border: '1px solid #e2e8f0',
            backgroundColor: '#f8fafc',
            cursor: 'pointer',
            fontSize: '13px',
            color: '#64748b',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
          title="Back to template list"
          aria-label="Back to template list"
        >
          ← Templates
        </button>

        <div style={{ width: '1px', height: '24px', backgroundColor: '#e2e8f0' }} />

        {/* Template Name (inline editable) */}
        <input
          data-testid="template-name-input"
          value={name}
          onChange={(e) => { if (!isReadOnly) { setName(e.target.value); setIsDirty(true); } }}
          readOnly={isReadOnly}
          title={name}
          aria-label="Template name"
          style={{
            border: 'none',
            fontSize: '14px',
            fontWeight: 600,
            padding: '4px 8px',
            borderRadius: '4px',
            backgroundColor: isReadOnly ? '#f1f5f9' : 'transparent',
            width: '200px',
            maxWidth: '200px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            cursor: isReadOnly ? 'not-allowed' : 'text',
          }}
          onFocus={(e) => { if (!isReadOnly) e.target.style.backgroundColor = '#f1f5f9'; }}
          onBlur={(e) => { if (!isReadOnly) e.target.style.backgroundColor = 'transparent'; }}
        />

        {/* Template Status Badge */}
        {templateStatus && (
          <span
            data-testid="template-status-badge"
            style={{
              padding: '2px 8px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              backgroundColor: templateStatus === 'published' ? '#dcfce7' : templateStatus === 'archived' ? '#f1f5f9' : '#fef9c3',
              color: templateStatus === 'published' ? '#166534' : templateStatus === 'archived' ? '#64748b' : '#854d0e',
              border: `1px solid ${templateStatus === 'published' ? '#bbf7d0' : templateStatus === 'archived' ? '#e2e8f0' : '#fde68a'}`,
            }}
          >
            {templateStatus}
          </span>
        )}

        <div style={{ width: '1px', height: '24px', backgroundColor: '#e2e8f0' }} />

        {/* Page Size Selector */}
        <select
          data-testid="page-size-selector"
          aria-label="Page size"
          value={pageSize}
          onChange={(e) => { setPageSize(e.target.value); setIsDirty(true); }}
          style={{
            padding: '4px 8px',
            borderRadius: '4px',
            border: '1px solid #e2e8f0',
            fontSize: '13px',
            backgroundColor: '#fff',
          }}
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <div style={{ width: '1px', height: '24px', backgroundColor: '#e2e8f0' }} />

        {/* Undo / Redo */}
        <button data-testid="btn-undo" title="Undo (Ctrl+Z)" aria-label="Undo (Ctrl+Z)" aria-keyshortcuts="Control+Z" style={{ ...toolbarBtnStyle, opacity: undoCount > 0 ? 1 : 0.4 }} disabled={undoCount === 0} onClick={handleUndo}>&#8617;</button>
        <button data-testid="btn-redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo (Ctrl+Shift+Z)" aria-keyshortcuts="Control+Shift+Z" style={{ ...toolbarBtnStyle, opacity: redoCount > 0 ? 1 : 0.4 }} disabled={redoCount === 0} onClick={handleRedo}>&#8618;</button>

        <div style={{ width: '1px', height: '24px', backgroundColor: '#e2e8f0' }} />

        {/* Zoom Control */}
        <select
          data-testid="zoom-selector"
          aria-label="Zoom level"
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          style={{
            padding: '4px 8px',
            borderRadius: '4px',
            border: '1px solid #e2e8f0',
            fontSize: '13px',
            backgroundColor: '#fff',
          }}
        >
          {ZOOM_LEVELS.map((z) => (
            <option key={z} value={z}>{z}%</option>
          ))}
        </select>

        {/* Page indicator */}
        <span
          data-testid="page-indicator"
          style={{
            fontSize: '12px',
            color: '#64748b',
            marginLeft: '4px',
          }}
        >
          Page {currentPageIndex + 1} / {pages.length}
        </span>

        <div style={{ flex: 1 }} />

        {/* Connection status indicator */}
        {templateId && !isOnline && (
          <span
            data-testid="connection-status"
            style={{
              fontSize: '11px',
              color: '#dc2626',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              backgroundColor: '#fef2f2',
              borderRadius: '4px',
              border: '1px solid #fecaca',
            }}
          >
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: '#ef4444' }} />
            Offline — changes will save when reconnected
          </span>
        )}
        {templateId && isOnline && pendingRetrySave && (
          <span
            data-testid="connection-status-reconnecting"
            style={{
              fontSize: '11px',
              color: '#b45309',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              backgroundColor: '#fffbeb',
              borderRadius: '4px',
              border: '1px solid #fde68a',
            }}
          >
            <span data-testid="reconnect-spinner" style={{ display: 'inline-block', width: 8, height: 8, border: '2px solid #f59e0b', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            Reconnected — saving changes…
          </span>
        )}

        {/* Auto-save status indicator */}
        {templateId && (
          <span
            data-testid="auto-save-indicator"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            style={{
              fontSize: '11px',
              color: autoSaveStatus === 'saving' ? '#b45309'
                : autoSaveStatus === 'saved' ? '#15803d'
                : autoSaveStatus === 'error' ? '#dc2626'
                : '#64748b',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            {autoSaveStatus === 'saving' && (
              <><span data-testid="auto-save-spinner" style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid #f59e0b', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />Saving...</>
            )}
            {autoSaveStatus === 'saved' && (
              <><span style={{ fontSize: '14px' }}>✓</span>Auto-saved</>
            )}
            {autoSaveStatus === 'error' && (
              <><span style={{ fontSize: '14px' }}>✗</span>Save failed</>
            )}
            {autoSaveStatus === 'idle' && lastAutoSave && (
              <>Last auto-saved {lastAutoSave.toLocaleTimeString()}</>
            )}
          </span>
        )}

        {/* Right-side actions */}
        <button
          data-testid="btn-preview-data"
          onClick={() => setPreviewMode((prev) => !prev)}
          style={{
            ...toolbarBtnStyle,
            backgroundColor: previewMode ? '#dbeafe' : undefined,
            borderColor: previewMode ? '#3b82f6' : undefined,
            color: previewMode ? '#1d4ed8' : undefined,
            fontWeight: previewMode ? 600 : undefined,
          }}
          title={previewMode ? 'Switch back to design mode (show binding placeholders)' : 'Preview with example data (resolve field bindings)'}
          aria-label={previewMode ? 'Switch to design mode' : 'Preview with example data'}
        >
          {previewMode ? 'Design Mode' : 'Preview Data'}
        </button>
        <button
          data-testid="btn-preview"
          aria-label="Preview PDF"
          onClick={handlePreview}
          disabled={renderStatus === 'loading' || renderStatus === 'progress'}
          style={{
            ...toolbarBtnStyle,
            opacity: (renderStatus === 'loading' || renderStatus === 'progress') ? 0.6 : 1,
            cursor: (renderStatus === 'loading' || renderStatus === 'progress') ? 'not-allowed' : 'pointer',
          }}
        >
          {renderStatus === 'loading' ? 'Generating…' : 'Preview'}
        </button>
        <button
          data-testid="btn-render"
          aria-label="Generate PDF"
          onClick={() => handleRenderNow()}
          disabled={renderStatus === 'loading' || renderStatus === 'progress'}
          style={{
            ...toolbarBtnStyle,
            backgroundColor: '#8b5cf6',
            color: '#fff',
            fontWeight: 600,
            opacity: (renderStatus === 'loading' || renderStatus === 'progress') ? 0.6 : 1,
            cursor: (renderStatus === 'loading' || renderStatus === 'progress') ? 'not-allowed' : 'pointer',
          }}
        >
          Generate PDF
        </button>
        <button
          data-testid="btn-async-render"
          aria-label="Async render PDF"
          onClick={() => handleAsyncRender()}
          disabled={renderStatus === 'loading' || renderStatus === 'progress'}
          style={{
            ...toolbarBtnStyle,
            backgroundColor: '#6366f1',
            color: '#fff',
            fontWeight: 600,
            opacity: (renderStatus === 'loading' || renderStatus === 'progress') ? 0.6 : 1,
            cursor: (renderStatus === 'loading' || renderStatus === 'progress') ? 'not-allowed' : 'pointer',
          }}
        >
          Async Render
        </button>
        <button
          data-testid="btn-save"
          aria-label="Save draft (Ctrl+S)" aria-keyshortcuts="Control+S"
          onClick={handleSave}
          disabled={saveStatus === 'saving' || isReadOnly}
          style={{
            ...toolbarBtnStyle,
            backgroundColor: saveStatus === 'error' ? '#dc2626' : isDirty ? '#2563eb' : '#475569',
            color: '#fff',
            fontWeight: 600,
            opacity: saveStatus === 'saving' ? 0.7 : 1,
            cursor: saveStatus === 'saving' ? 'not-allowed' : 'pointer',
          }}
        >
          {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Retry Save' : 'Save Draft'}
        </button>
        <button
          data-testid="btn-publish"
          aria-label="Publish template"
          onClick={handlePublish}
          disabled={publishStatus === 'publishing' || isReadOnly}
          style={{
            ...toolbarBtnStyle,
            backgroundColor: publishStatus === 'error' ? '#ef4444' : publishStatus === 'published' ? '#059669' : '#10b981',
            color: '#fff',
            fontWeight: 600,
            opacity: publishStatus === 'publishing' ? 0.7 : 1,
            cursor: publishStatus === 'publishing' ? 'not-allowed' : 'pointer',
          }}
        >
          {publishStatus === 'publishing' ? 'Publishing…' : publishStatus === 'published' ? '✓ Published' : publishStatus === 'error' ? 'Retry Publish' : 'Publish'}
        </button>
        <button
          data-testid="btn-keyboard-shortcuts"
          aria-label="Keyboard shortcuts (?)"
          aria-keyshortcuts="Shift+/"
          onClick={() => setShowShortcutsHelp((prev) => !prev)}
          title="Keyboard shortcuts (?)"
          style={{
            ...toolbarBtnStyle,
            fontSize: '14px',
            minWidth: '32px',
          }}
        >
          &#x2328;
        </button>
        <button
          data-testid="btn-archive"
          aria-label="Archive template"
          onClick={handleArchive}
          disabled={archiveStatus === 'archiving' || archiveStatus === 'archived'}
          style={{
            ...toolbarBtnStyle,
            backgroundColor: archiveStatus === 'archived' ? '#6b7280' : '#f59e0b',
            color: '#fff',
            fontWeight: 600,
            opacity: archiveStatus === 'archiving' ? 0.7 : 1,
            cursor: archiveStatus === 'archiving' ? 'not-allowed' : 'pointer',
          }}
        >
          {archiveStatus === 'archiving' ? 'Archiving…' : archiveStatus === 'archived' ? '✓ Archived' : 'Archive'}
        </button>
      </div>

      {/* ─── Save Error Banner ─── */}
      {saveStatus === 'error' && saveError && (
        <div
          data-testid="save-error-banner"
          role="alert"
          aria-live="assertive"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#fef2f2',
            borderBottom: '1px solid #fecaca',
            padding: '8px 16px',
            fontSize: '13px',
            color: '#991b1b',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span data-testid="save-error-icon" style={{ fontSize: '16px' }}>⚠</span>
            <span data-testid="save-error-message">{saveError}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              data-testid="save-error-retry"
              aria-label="Retry save"
              onClick={handleSave}
              style={{
                padding: '4px 12px',
                backgroundColor: '#ef4444',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              Retry
            </button>
            <button
              data-testid="save-error-dismiss"
              aria-label="Dismiss error"
              onClick={() => { setSaveStatus('idle'); setSaveError(null); }}
              style={{
                padding: '4px 8px',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: '16px',
                color: '#991b1b',
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ─── Save Success Toast ─── */}
      {saveStatus === 'saved' && (
        <div
          data-testid="save-success-toast"
          role="status"
          aria-live="polite"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: '#eff6ff',
            borderBottom: '1px solid #bfdbfe',
            padding: '8px 16px',
            fontSize: '13px',
            color: '#1e40af',
          }}
        >
          <span data-testid="save-success-icon" style={{ fontSize: '16px' }}>✓</span>
          <span data-testid="save-success-message">Draft saved successfully</span>
          <span data-testid="save-success-type" style={{ fontSize: '11px', color: '#6b7280', marginLeft: '4px' }}>(manual save)</span>
        </div>
      )}

      {/* ─── Publish Error Banner ─── */}
      {publishStatus === 'error' && publishError && (
        <div
          data-testid="publish-error-banner"
          role="alert"
          aria-live="assertive"
          style={{
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#fef2f2',
            borderBottom: '1px solid #fecaca',
            padding: '8px 16px',
            fontSize: '13px',
            color: '#991b1b',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}>⚠</span>
              <span data-testid="publish-error-message">{publishError}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                data-testid="publish-error-retry"
                aria-label="Retry publish"
                onClick={handlePublish}
                style={{
                  padding: '4px 12px',
                  backgroundColor: '#ef4444',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                Retry
              </button>
              <button
                data-testid="publish-error-dismiss"
                aria-label="Dismiss publish error"
                onClick={() => { setPublishStatus('idle'); setPublishError(null); setPublishErrors([]); }}
                style={{
                  padding: '4px 8px',
                  backgroundColor: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '16px',
                  color: '#991b1b',
                }}
              >
                ✕
              </button>
            </div>
          </div>
          {publishErrors.length > 0 && (
            <ul data-testid="publish-validation-errors" role="list" aria-label="Validation errors" style={{ margin: '4px 0 0 24px', padding: 0, listStyle: 'disc' }}>
              {publishErrors.map((err, i) => (
                <li
                  key={i}
                  data-testid={`publish-validation-error-${i}`}
                  data-element-id={err.elementId || ''}
                  data-page-index={err.pageIndex !== undefined ? err.pageIndex : ''}
                  tabIndex={err.elementId ? 0 : undefined}
                  role={err.elementId ? 'button' : undefined}
                  onClick={err.elementId ? () => handleValidationErrorClick(err) : undefined}
                  onKeyDown={err.elementId ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleValidationErrorClick(err); } } : undefined}
                  style={{
                    fontSize: '12px',
                    marginTop: '2px',
                    cursor: err.elementId ? 'pointer' : 'default',
                    textDecoration: err.elementId ? 'underline' : 'none',
                    padding: '2px 4px',
                    borderRadius: '2px',
                  }}
                  onMouseEnter={(e) => { if (err.elementId) (e.currentTarget as HTMLElement).style.backgroundColor = '#fecaca'; }}
                  onMouseLeave={(e) => { if (err.elementId) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                >
                  <strong>{err.field}</strong>: {err.message}
                  {err.elementId && <span style={{ marginLeft: '4px', fontSize: '10px', color: '#6b7280' }}>(click to select)</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ─── Publish Success Toast ─── */}
      {publishStatus === 'published' && (
        <div
          data-testid="publish-success-toast"
          role="status"
          aria-live="polite"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: '#ecfdf5',
            borderBottom: '1px solid #a7f3d0',
            padding: '8px 16px',
            fontSize: '13px',
            color: '#065f46',
          }}
        >
          <span style={{ fontSize: '16px' }}>✓</span>
          <span>Template published successfully</span>
        </div>
      )}

      {/* ─── Three-Panel Layout ─── */}
      <div
        className="erp-designer-panels"
        data-testid="designer-panels"
        style={{
          display: 'flex',
          flex: 1,
          overflow: 'hidden',
        }}
      >
        {/* ─── Left Panel Collapse Button (when collapsed) ─── */}
        {leftPanelCollapsed && !isNarrowViewport && (
          <div
            data-testid="left-panel-expand"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              backgroundColor: '#ffffff',
              borderRight: '1px solid #e2e8f0',
              flexShrink: 0,
              width: '36px',
            }}
          >
            <button
              data-testid="btn-expand-left-panel"
              aria-label="Expand left panel"
              tabIndex={0}
              onClick={() => setLeftPanelCollapsed(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setLeftPanelCollapsed(false);
                }
              }}
              style={{
                marginTop: '8px',
                padding: '4px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: '16px',
                color: '#64748b',
                borderRadius: '4px',
              }}
              title="Expand left panel"
            >
              ▶
            </button>
          </div>
        )}
        {/* ─── Left Panel ─── */}
        <div
          className={`erp-designer-left-panel${isNarrowViewport && mobilePanelOpen !== 'left' ? ' panel-hidden' : ''}`}
          data-testid="left-panel"
          style={{
            width: leftPanelCollapsed && !isNarrowViewport ? '0px' : '260px',
            maxWidth: leftPanelCollapsed && !isNarrowViewport ? '0px' : '260px',
            backgroundColor: '#ffffff',
            borderRight: leftPanelCollapsed && !isNarrowViewport ? 'none' : '1px solid #e2e8f0',
            display: leftPanelCollapsed && !isNarrowViewport ? 'none' : 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            overflow: 'hidden',
          }}
        >
          {/* Tabs */}
          <div
            data-testid="left-panel-tabs"
            role="tablist"
            aria-label="Left panel tabs"
            style={{
              display: 'flex',
              borderBottom: '1px solid #e2e8f0',
            }}
          >
            {(['blocks', 'fields', 'assets', 'pages'] as LeftTab[]).map((tab) => (
              <button
                key={tab}
                data-testid={`tab-${tab}`}
                role="tab"
                aria-selected={activeTab === tab}
                aria-controls={`tabpanel-${tab}`}
                id={`tab-${tab}-btn`}
                aria-label={`${tab} tab`}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1,
                  padding: '10px 4px',
                  fontSize: '12px',
                  fontWeight: activeTab === tab ? 600 : 400,
                  color: activeTab === tab ? '#2563eb' : '#64748b',
                  backgroundColor: 'transparent',
                  border: 'none',
                  borderBottom: activeTab === tab ? '2px solid #3b82f6' : '2px solid transparent',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {tab}
              </button>
            ))}
            {!isNarrowViewport && (
              <button
                data-testid="btn-collapse-left-panel"
                aria-label="Collapse left panel"
                tabIndex={0}
                onClick={() => setLeftPanelCollapsed(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setLeftPanelCollapsed(true);
                  }
                }}
                style={{
                  padding: '6px 8px',
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: '14px',
                  color: '#64748b',
                  borderRadius: '4px',
                  flexShrink: 0,
                }}
                title="Collapse left panel"
              >
                ◀
              </button>
            )}
          </div>

          {/* Tab Content */}
          <div
            role="tabpanel"
            id={`tabpanel-${activeTab}`}
            aria-labelledby={`tab-${activeTab}-btn`}
            data-testid="left-panel-tabpanel"
            style={{ flex: 1, overflow: 'auto', padding: '12px' }}
          >
            {activeTab === 'blocks' && (
              <div data-testid="blocks-content">
                {BLOCK_CATEGORIES.map((cat) => (
                  <div key={cat.name} style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.5px' }}>
                      {cat.name}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      {cat.blocks.map((block) => (
                        <div
                          key={block.id}
                          className="block-card"
                          data-testid={`block-${block.id}`}
                          role="button"
                          tabIndex={0}
                          aria-label={`Add ${block.label} block`}
                          draggable
                          onDragStart={(e) => handleBlockDragStart(e, block.id)}
                          onClick={() => addElementToCanvas(block.id)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addElementToCanvas(block.id); } }}
                          style={{
                            padding: '8px',
                            borderRadius: '6px',
                            border: '1px solid #e2e8f0',
                            backgroundColor: '#f8fafc',
                            cursor: 'grab',
                            textAlign: 'center',
                            fontSize: '11px',
                            minHeight: '52px',
                            display: 'flex',
                            flexDirection: 'column' as const,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <div style={{ fontSize: '16px', marginBottom: '2px' }}>{block.icon}</div>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{block.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {activeTab === 'fields' && (
              <div data-testid="fields-content">
                <input
                  data-testid="field-tab-search"
                  placeholder="Search fields..."
                  value={fieldTabSearch}
                  onChange={(e) => setFieldTabSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: '4px',
                    border: '1px solid #e2e8f0',
                    fontSize: '13px',
                    marginBottom: '12px',
                  }}
                />
                <div style={{ fontSize: '13px', color: '#64748b' }}>
                  {filteredFieldTabFields.length === 0 && fieldTabSearch ? (
                    <div data-testid="fields-empty-state" style={{
                      textAlign: 'center',
                      padding: '24px 12px',
                      color: '#64748b',
                    }}>
                      <div style={{ fontSize: '24px', marginBottom: '8px' }}>🔍</div>
                      <div style={{ fontWeight: 500, marginBottom: '4px', color: '#64748b' }}>No matching fields</div>
                      <div style={{ fontSize: '12px' }}>No fields match &quot;{fieldTabSearch}&quot;</div>
                    </div>
                  ) : (
                    filteredFieldTabFields.map((group) => (
                      <div key={group.group}>
                        <div style={{ fontWeight: 600, marginBottom: '4px' }}>{group.group}</div>
                        {group.fields.map((field) => (
                          <div
                            key={field.key}
                            data-testid={`field-${field.key}`}
                            role="option"
                            tabIndex={0}
                            aria-label={`Bind field ${field.key}`}
                            draggable
                            onDragStart={(e) => handleFieldDragStart(e, field.key)}
                            title={field.key}
                            style={{ paddingLeft: '12px', marginBottom: '2px', cursor: 'grab', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            onClick={() => {
                              if (selectedElementId && selectedElement && (getElementCategory(selectedElement.type) === 'text' || selectedElement.type === 'qr-barcode')) {
                                handleBindField(field.key);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                if (selectedElementId && selectedElement && (getElementCategory(selectedElement.type) === 'text' || selectedElement.type === 'qr-barcode')) {
                                  handleBindField(field.key);
                                }
                              }
                            }}
                          >
                            {`{{${field.key}}}`}
                          </div>
                        ))}
                        <div style={{ height: '8px' }} />
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
            {activeTab === 'assets' && (
              <div data-testid="assets-content">
                <input
                  ref={assetFileInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.svg,.webp,.gif"
                  style={{ display: 'none' }}
                  data-testid="asset-file-input"
                  onChange={handleAssetFileChange}
                />
                <button
                  data-testid="asset-upload-btn"
                  aria-label="Upload asset"
                  style={{
                    ...toolbarBtnStyle,
                    width: '100%',
                    marginBottom: assetUploadStatus === 'uploading' || assetUploadStatus === 'success' ? '4px' : '12px',
                    opacity: assetUploadStatus === 'uploading' ? 0.6 : 1,
                    cursor: assetUploadStatus === 'uploading' ? 'wait' : 'pointer',
                  }}
                  disabled={assetUploadStatus === 'uploading'}
                  onClick={() => assetFileInputRef.current?.click()}
                >
                  {assetUploadStatus === 'uploading' ? `Uploading… ${assetUploadProgress}%` : assetUploadStatus === 'success' ? '✓ Upload Complete' : 'Upload Asset'}
                </button>
                {/* Upload progress bar */}
                {(assetUploadStatus === 'uploading' || assetUploadStatus === 'success') && (
                  <div data-testid="asset-upload-progress-section" style={{ marginBottom: '12px' }}>
                    <div style={{
                      width: '100%',
                      height: '6px',
                      backgroundColor: '#e2e8f0',
                      borderRadius: '3px',
                      overflow: 'hidden',
                      marginBottom: '4px',
                    }}>
                      <div
                        data-testid="asset-upload-progress-bar"
                        style={{
                          height: '100%',
                          width: `${assetUploadProgress}%`,
                          backgroundColor: assetUploadStatus === 'success' ? '#10b981' : '#3b82f6',
                          borderRadius: '3px',
                          transition: 'width 0.2s ease',
                        }}
                      />
                    </div>
                    <div data-testid="asset-upload-progress-text" style={{ fontSize: '11px', color: assetUploadStatus === 'success' ? '#15803d' : '#64748b', textAlign: 'center' }}>
                      {assetUploadStatus === 'success' ? 'Upload complete — asset added to library' : `Uploading… ${assetUploadProgress}%`}
                    </div>
                  </div>
                )}
                {assetUploadStatus === 'error' && assetUploadError && (
                  <div
                    data-testid="asset-upload-error"
                    style={{
                      fontSize: '12px',
                      color: '#dc2626',
                      backgroundColor: '#fef2f2',
                      padding: '8px',
                      borderRadius: '4px',
                      marginBottom: '8px',
                    }}
                  >
                    {assetUploadError}
                  </div>
                )}
                {assets.length === 0 ? (
                  <div style={{ fontSize: '13px', color: '#64748b', textAlign: 'center', padding: '20px 0' }}>
                    No assets uploaded yet
                  </div>
                ) : (
                  <div data-testid="assets-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {assets.map((asset) => (
                      <div
                        key={asset.id}
                        data-testid={`asset-item-${asset.id}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '6px 8px',
                          borderRadius: '6px',
                          backgroundColor: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          cursor: 'pointer',
                          fontSize: '12px',
                        }}
                        title={asset.filename}
                      >
                        {asset.mimeType.startsWith('image/') ? (
                          <div style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '4px',
                            backgroundColor: '#e2e8f0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '10px',
                            color: '#64748b',
                            flexShrink: 0,
                          }}>
                            IMG
                          </div>
                        ) : (
                          <div style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '4px',
                            backgroundColor: '#e2e8f0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '10px',
                            color: '#64748b',
                            flexShrink: 0,
                          }}>
                            FILE
                          </div>
                        )}
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {asset.filename}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {activeTab === 'pages' && (
              <div data-testid="pages-content">
                {/* Page thumbnails strip */}
                {pages.map((page, index) => (
                  <div
                    key={page.id}
                    data-testid={`page-thumbnail-${index}`}
                    role="tab"
                    tabIndex={0}
                    aria-label={`Page ${index + 1}`}
                    aria-selected={index === currentPageIndex}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={(e) => handleDrop(e, index)}
                    onDragEnd={handleDragEnd}
                    onContextMenu={(e) => handleContextMenu(e, index)}
                    onClick={() => setCurrentPageIndex(index)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCurrentPageIndex(index); } }}
                    style={{
                      padding: '8px',
                      border: index === currentPageIndex
                        ? '2px solid #3b82f6'
                        : dragOverIndex === index
                        ? '2px dashed #3b82f6'
                        : '2px solid transparent',
                      borderRadius: '6px',
                      backgroundColor: index === currentPageIndex ? '#eff6ff' : dragOverIndex === index ? '#f0f9ff' : '#f8fafc',
                      textAlign: 'center',
                      fontSize: '12px',
                      marginBottom: '8px',
                      cursor: 'pointer',
                      opacity: dragIndex === index ? 0.5 : 1,
                      transition: 'border-color 0.15s, background-color 0.15s, opacity 0.15s',
                      userSelect: 'none',
                    }}
                  >
                    {/* Thumbnail preview */}
                    <div
                      data-testid={`page-thumb-preview-${index}`}
                      style={{
                        width: '100%',
                        height: '80px',
                        backgroundColor: '#fff',
                        border: index === currentPageIndex ? '1px solid #93c5fd' : '1px solid #e2e8f0',
                        borderRadius: '4px',
                        marginBottom: '4px',
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                    >
                      {page.elements.length > 0 ? (
                        page.elements.map((el) => (
                          <div
                            key={el.id}
                            style={{
                              position: 'absolute',
                              left: `${(el.x / 595) * 100}%`,
                              top: `${(el.y / 842) * 100}%`,
                              width: `${(el.w / 595) * 100}%`,
                              height: `${(el.h / 842) * 100}%`,
                              backgroundColor: '#e2e8f0',
                              borderRadius: '1px',
                            }}
                          />
                        ))
                      ) : (
                        <div
                          style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            fontSize: '9px',
                            color: '#cbd5e1',
                          }}
                        >
                          Empty
                        </div>
                      )}
                    </div>
                    <span
                      data-testid={`page-label-${index}`}
                      style={{
                        fontWeight: index === currentPageIndex ? 600 : 400,
                        color: index === currentPageIndex ? '#2563eb' : '#64748b',
                      }}
                    >
                      {page.label}
                    </span>
                  </div>
                ))}

                {/* Add Page button */}
                <button
                  data-testid="btn-add-page"
                  aria-label="Add page"
                  onClick={addPage}
                  style={{
                    ...toolbarBtnStyle,
                    width: '100%',
                    marginTop: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                  }}
                >
                  <span style={{ fontSize: '16px', lineHeight: 1 }}>+</span> Add Page
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ─── Mobile Panel Overlay Backdrop ─── */}
        {isNarrowViewport && mobilePanelOpen && (
          <div
            data-testid="mobile-panel-backdrop"
            onClick={() => setMobilePanelOpen(null)}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.3)',
              zIndex: 99,
            }}
          />
        )}

        {/* ─── Center Canvas ─── */}
        <div
          className="erp-designer-canvas"
          data-testid="center-canvas"
          ref={canvasRef}
          style={{
            flex: 1,
            minWidth: 0,
            backgroundColor: '#e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'auto',
            padding: '24px',
            position: 'relative',
          }}
          onClick={() => {
            setSelectedElementId(null);
            setShowBindingPicker(false);
          }}
        >
          {/* ─── Mobile Panel Toggle Buttons ─── */}
          {isNarrowViewport && (
            <>
              <button
                data-testid="btn-toggle-left-panel"
                aria-label="Toggle blocks and fields panel"
                onClick={(e) => {
                  e.stopPropagation();
                  setMobilePanelOpen(mobilePanelOpen === 'left' ? null : 'left');
                }}
                style={{
                  position: 'absolute',
                  top: '8px',
                  left: '8px',
                  zIndex: 50,
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid #e2e8f0',
                  backgroundColor: mobilePanelOpen === 'left' ? '#3b82f6' : '#ffffff',
                  color: mobilePanelOpen === 'left' ? '#fff' : '#334155',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 600,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                }}
                title="Toggle blocks/fields panel"
              >
                ☰ Blocks
              </button>
              <button
                data-testid="btn-toggle-right-panel"
                aria-label="Toggle properties panel"
                onClick={(e) => {
                  e.stopPropagation();
                  setMobilePanelOpen(mobilePanelOpen === 'right' ? null : 'right');
                }}
                style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  zIndex: 50,
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid #e2e8f0',
                  backgroundColor: mobilePanelOpen === 'right' ? '#3b82f6' : '#ffffff',
                  color: mobilePanelOpen === 'right' ? '#fff' : '#334155',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 600,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                }}
                title="Toggle properties panel"
              >
                ⚙ Properties
              </button>
            </>
          )}
          {/* A4 Page */}
          <div
            data-testid="canvas-page"
            onDragOver={handleCanvasDragOver}
            onDrop={handleCanvasDrop}
            style={{
              width: `${595 * (zoom / 100)}px`,
              height: `${842 * (zoom / 100)}px`,
              backgroundColor: '#ffffff',
              boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
              borderRadius: '2px',
              position: 'relative',
              transition: 'width 0.2s, height 0.2s',
              // Crisp rendering at all zoom levels
              imageRendering: 'auto' as React.CSSProperties['imageRendering'],
              textRendering: 'optimizeLegibility' as React.CSSProperties['textRendering'],
              WebkitFontSmoothing: 'antialiased',
            } as React.CSSProperties}
          >
            {/* Page label overlay */}
            <div
              style={{
                position: 'absolute',
                top: '8px',
                left: '8px',
                fontSize: `${10 * (zoom / 100)}px`,
                color: '#64748b',
                userSelect: 'none',
                zIndex: 1,
              }}
            >
              {currentPage?.label}
            </div>

            {/* Preview mode indicator */}
            {previewMode && (
              <div
                data-testid="preview-mode-badge"
                style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  fontSize: `${10 * (zoom / 100)}px`,
                  color: '#1d4ed8',
                  backgroundColor: '#dbeafe',
                  padding: `${2 * (zoom / 100)}px ${6 * (zoom / 100)}px`,
                  borderRadius: '4px',
                  fontWeight: 600,
                  userSelect: 'none',
                  zIndex: 1,
                }}
              >
                PREVIEW
              </div>
            )}

            {/* Render elements on canvas */}
            {currentPage && currentPage.elements.map((el) => renderCanvasElement(el))}

            {/* Placeholder content showing it's a template canvas */}
            {currentPage && currentPage.elements.length === 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  textAlign: 'center',
                  color: '#cbd5e1',
                  fontSize: `${14 * (zoom / 100)}px`,
                  userSelect: 'none',
                }}
              >
                <div style={{ fontSize: `${24 * (zoom / 100)}px`, marginBottom: '8px' }}>+</div>
                Drag blocks here or click to add
              </div>
            )}
          </div>
        </div>

        {/* ─── Right Properties Panel ─── */}
        {rightPanelCollapsed && !isNarrowViewport && (
          <div
            data-testid="right-panel-expand"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              backgroundColor: '#ffffff',
              borderLeft: '1px solid #e2e8f0',
              flexShrink: 0,
              width: '36px',
            }}
          >
            <button
              data-testid="btn-expand-right-panel"
              aria-label="Expand right panel"
              tabIndex={0}
              onClick={() => setRightPanelCollapsed(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setRightPanelCollapsed(false);
                }
              }}
              style={{
                marginTop: '8px',
                padding: '4px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: '16px',
                color: '#64748b',
                borderRadius: '4px',
              }}
              title="Expand right panel"
            >
              ◀
            </button>
          </div>
        )}
        <div
          className={`erp-designer-right-panel${isNarrowViewport && mobilePanelOpen !== 'right' ? ' panel-hidden' : ''}`}
          data-testid="right-panel"
          role="complementary"
          aria-label="Element properties panel"
          style={{
            width: rightPanelCollapsed && !isNarrowViewport ? '0px' : '280px',
            backgroundColor: '#ffffff',
            borderLeft: rightPanelCollapsed && !isNarrowViewport ? 'none' : '1px solid #e2e8f0',
            display: rightPanelCollapsed && !isNarrowViewport ? 'none' : 'flex',
            flexDirection: 'column',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #e2e8f0',
              fontSize: '13px',
              fontWeight: 600,
              color: '#334155',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            Properties
            {!isNarrowViewport && (
              <button
                data-testid="btn-collapse-right-panel"
                aria-label="Collapse right panel"
                tabIndex={0}
                onClick={() => setRightPanelCollapsed(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setRightPanelCollapsed(true);
                  }
                }}
                style={{
                  padding: '2px 6px',
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: '14px',
                  color: '#64748b',
                  borderRadius: '4px',
                }}
                title="Collapse right panel"
              >
                ▶
              </button>
            )}
          </div>
          <div
            data-testid="properties-scroll-container"
            style={{ flex: 1, overflow: 'auto', padding: '16px', overscrollBehavior: 'contain' }}
          >
            {renderPropertiesPanel()}
          </div>
        </div>
      </div>

      {/* ─── Render Progress Overlay ─── */}
      {renderStatus !== 'idle' && (
        <div
          ref={renderDialogRef}
          data-testid="render-overlay"
          role="alertdialog"
          aria-modal="true"
          aria-label={renderStatus === 'error' ? 'Render error' : renderStatus === 'complete' ? 'Render complete' : 'Rendering in progress'}
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
            zIndex: 2000,
          }}
        >
          <div
            data-testid="render-dialog"
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              padding: '32px',
              minWidth: 'min(400px, 90vw)',
              maxWidth: 'min(480px, 94vw)',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
              textAlign: 'center',
            }}
          >
            {/* Loading spinner */}
            {(renderStatus === 'loading' || renderStatus === 'progress') && (
              <div data-testid="render-spinner" style={{ marginBottom: '16px' }}>
                <div style={{
                  width: 48,
                  height: 48,
                  border: '4px solid #e2e8f0',
                  borderTopColor: '#8b5cf6',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  margin: '0 auto',
                }} />
              </div>
            )}

            {/* Complete icon */}
            {renderStatus === 'complete' && (
              <div data-testid="render-complete-icon" style={{ marginBottom: '16px', fontSize: '48px', color: '#15803d' }}>
                ✓
              </div>
            )}

            {/* Error icon */}
            {renderStatus === 'error' && (
              <div data-testid="render-error-icon" style={{ marginBottom: '16px', fontSize: '48px', color: '#dc2626' }}>
                ✗
              </div>
            )}

            {/* Status message */}
            <div
              data-testid="render-message"
              style={{
                fontSize: '16px',
                fontWeight: 600,
                color: renderStatus === 'error' ? '#dc2626' : renderStatus === 'complete' ? '#15803d' : '#334155',
                marginBottom: '12px',
              }}
            >
              {renderMessage}
            </div>

            {/* Async job status indicator */}
            {asyncJobStatus && (
              <div data-testid="async-job-status" style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', alignItems: 'center' }}>
                  {['queued', 'generating', 'done'].map((step) => {
                    const isActive = step === asyncJobStatus;
                    const isPast = (step === 'queued' && (asyncJobStatus === 'generating' || asyncJobStatus === 'done'))
                      || (step === 'generating' && asyncJobStatus === 'done');
                    const isFailed = asyncJobStatus === 'failed';
                    return (
                      <React.Fragment key={step}>
                        <div
                          data-testid={`async-step-${step}`}
                          style={{
                            padding: '4px 12px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            fontWeight: isActive ? 700 : 500,
                            backgroundColor: isFailed && isActive ? '#fef2f2'
                              : isPast ? '#ecfdf5'
                              : isActive ? '#eff6ff'
                              : '#f1f5f9',
                            color: isFailed && isActive ? '#dc2626'
                              : isPast ? '#059669'
                              : isActive ? '#2563eb'
                              : '#64748b',
                            border: `1px solid ${
                              isFailed && isActive ? '#fca5a5'
                              : isPast ? '#a7f3d0'
                              : isActive ? '#93c5fd'
                              : '#e2e8f0'
                            }`,
                          }}
                        >
                          {isPast ? '✓ ' : ''}{step.charAt(0).toUpperCase() + step.slice(1)}
                        </div>
                        {step !== 'done' && (
                          <div style={{ width: '24px', height: '2px', backgroundColor: isPast ? '#a7f3d0' : '#e2e8f0' }} />
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
                {asyncJobStatus === 'failed' && (
                  <div data-testid="async-step-failed" style={{ marginTop: '8px', fontSize: '12px', color: '#dc2626', fontWeight: 600 }}>
                    ✗ Failed
                  </div>
                )}
              </div>
            )}

            {/* Progress bar for bulk render */}
            {(renderStatus === 'progress' || (renderStatus === 'complete' && renderProgress.total > 1)) && (
              <div data-testid="render-progress-section" style={{ marginBottom: '16px' }}>
                <div style={{
                  width: '100%',
                  height: '8px',
                  backgroundColor: '#e2e8f0',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  marginBottom: '8px',
                }}>
                  <div
                    data-testid="render-progress-bar"
                    style={{
                      height: '100%',
                      width: `${renderProgress.total > 0 ? ((renderProgress.completed + renderProgress.failed) / renderProgress.total) * 100 : 0}%`,
                      backgroundColor: renderProgress.failed > 0 ? '#f59e0b' : '#8b5cf6',
                      borderRadius: '4px',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
                <div data-testid="render-progress-text" style={{ fontSize: '13px', color: '#64748b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>
                    {renderProgress.completed + renderProgress.failed} / {renderProgress.total} complete
                    {renderProgress.failed > 0 && (
                      <span style={{ color: '#dc2626', marginLeft: '8px' }}>({renderProgress.failed} failed)</span>
                    )}
                  </span>
                  <span data-testid="render-progress-percentage" style={{ fontWeight: 600, color: '#334155' }}>
                    {renderProgress.total > 0 ? Math.round(((renderProgress.completed + renderProgress.failed) / renderProgress.total) * 100) : 0}%
                  </span>
                </div>
              </div>
            )}

            {/* Download link on completion */}
            {renderStatus === 'complete' && renderResult?.downloadUrl && (
              <a
                data-testid="render-download-link"
                href={renderResult.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-block',
                  padding: '8px 24px',
                  backgroundColor: '#8b5cf6',
                  color: '#fff',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  fontWeight: 600,
                  fontSize: '14px',
                  marginBottom: '12px',
                }}
              >
                Download PDF
              </a>
            )}

            {/* Dismiss button */}
            {(renderStatus === 'complete' || renderStatus === 'error') && (
              <div>
                <button
                  data-testid="render-dismiss"
                  aria-label="Dismiss render overlay"
                  onClick={dismissRenderOverlay}
                  style={{
                    padding: '8px 24px',
                    backgroundColor: 'transparent',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    color: '#64748b',
                    marginTop: '8px',
                  }}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Context Menu (portal-like, fixed position) ─── */}
      {contextMenu.visible && (
        <div
          ref={contextMenuRef}
          data-testid="page-context-menu"
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            padding: '4px 0',
            minWidth: '160px',
            zIndex: 1000,
          }}
        >
          <button
            data-testid="ctx-duplicate-page"
            aria-label="Duplicate page"
            onClick={() => duplicatePage(contextMenu.pageIndex)}
            style={contextMenuItemStyle}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            Duplicate Page
          </button>
          <div style={{ height: '1px', backgroundColor: '#e2e8f0', margin: '4px 0' }} />
          <button
            data-testid="ctx-delete-page"
            aria-label="Delete page"
            onClick={() => deletePage(contextMenu.pageIndex)}
            disabled={pages.length <= 1}
            style={{
              ...contextMenuItemStyle,
              color: pages.length <= 1 ? '#cbd5e1' : '#dc2626',
              cursor: pages.length <= 1 ? 'not-allowed' : 'pointer',
            }}
            onMouseEnter={(e) => {
              if (pages.length > 1) e.currentTarget.style.backgroundColor = '#fef2f2';
            }}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            Delete Page
            {pages.length <= 1 && <span style={{ fontSize: '11px', marginLeft: 'auto', color: '#64748b' }}>(last page)</span>}
          </button>
        </div>
      )}
    </div>

    {/* ─── Loading Overlay for Save/Publish operations (#286) ─── */}
    {(saveStatus === 'saving' || publishStatus === 'publishing') && (
      <div
        data-testid="operation-loading-overlay"
        role="status"
        aria-live="polite"
        aria-label={saveStatus === 'saving' ? 'Saving draft' : 'Publishing template'}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(255,255,255,0.6)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          gap: '12px',
        }}
      >
        <div
          data-testid="operation-spinner"
          style={{
            width: '36px',
            height: '36px',
            border: '3px solid #e5e7eb',
            borderTopColor: saveStatus === 'saving' ? '#3b82f6' : '#10b981',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <div data-testid="operation-loading-text" style={{ fontSize: '14px', fontWeight: 500, color: '#6b7280' }}>
          {saveStatus === 'saving' ? 'Saving draft...' : 'Publishing template...'}
        </div>
      </div>
    )}


      {/* ─── Keyboard Shortcuts Help Dialog ─── */}
      {showShortcutsHelp && (
        <div
          ref={shortcutsDialogRef}
          data-testid="keyboard-shortcuts-dialog"
          role="dialog"
          aria-label="Keyboard shortcuts"
          aria-modal="true"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.4)',
            zIndex: 10002,
          }}
          onClick={() => setShowShortcutsHelp(false)}
        >
          <div
            data-testid="keyboard-shortcuts-panel"
            style={{
              backgroundColor: '#fff',
              borderRadius: '12px',
              padding: '24px',
              minWidth: '360px',
              maxWidth: 'min(480px, calc(100vw - 48px))',
              maxHeight: '80vh',
              overflowY: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1e293b', margin: 0 }}>Keyboard Shortcuts</h2>
              <button
                data-testid="shortcuts-close-btn"
                aria-label="Close shortcuts dialog"
                onClick={() => setShowShortcutsHelp(false)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#64748b', padding: '4px' }}
              >
                &times;
              </button>
            </div>
            <table data-testid="shortcuts-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#64748b', fontWeight: 600 }}>Action</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', color: '#64748b', fontWeight: 600 }}>Shortcut</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Undo', 'Ctrl + Z'],
                  ['Redo', 'Ctrl + Shift + Z'],
                  ['Redo (alt)', 'Ctrl + Y'],
                  ['Save draft', 'Ctrl + S'],
                  ['Delete element', 'Delete / Backspace'],
                  ['Move element (1px)', 'Arrow Keys'],
                  ['Move element (10px)', 'Shift + Arrow Keys'],
                  ['Select element', 'Enter / Space'],
                  ['Show shortcuts', '?'],
                  ['Close dialog', 'Escape'],
                ].map(([action, shortcut], i) => (
                  <tr key={i} data-testid={`shortcut-row-${i}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 12px', color: '#334155' }}>{action}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                      <kbd style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontFamily: 'monospace',
                        color: '#475569',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                      }}>{shortcut}</kbd>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ marginTop: '12px', fontSize: '11px', color: '#64748b', textAlign: 'center' }}>
              Shortcuts are disabled while typing in input fields. Screen readers can navigate all controls via Tab.
            </p>
          </div>
        </div>
      )}

    {/* ─── Toast Notification Container (#287) ─── */}
    {toasts.length > 0 && (
      <div
        data-testid="toast-container"
        style={{
          position: 'fixed',
          top: '16px',
          right: '16px',
          zIndex: 10001,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          maxWidth: 'min(400px, calc(100vw - 32px))',
        }}
      >
        {toasts.map((toast) => {
          const bgColors: Record<string, string> = { success: '#ecfdf5', error: '#fef2f2', warning: '#fffbeb', info: '#eff6ff' };
          const borderColors: Record<string, string> = { success: '#a7f3d0', error: '#fecaca', warning: '#fde68a', info: '#bfdbfe' };
          const textColors: Record<string, string> = { success: '#065f46', error: '#991b1b', warning: '#854d0e', info: '#1e40af' };
          const icons: Record<string, string> = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
          return (
            <div
              key={toast.id}
              data-testid={`toast-${toast.type}`}
              data-toast-id={toast.id}
              role={toast.type === 'error' ? 'alert' : 'status'}
              aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 14px',
                backgroundColor: bgColors[toast.type] || bgColors.info,
                border: `1px solid ${borderColors[toast.type] || borderColors.info}`,
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                fontSize: '13px',
                color: textColors[toast.type] || textColors.info,
                animation: 'toast-slide-in 0.3s ease-out',
              }}
            >
              <span style={{ fontSize: '16px', flexShrink: 0 }}>{icons[toast.type]}</span>
              <span data-testid="toast-message" style={{ flex: 1 }}>{toast.message}</span>
              <button
                data-testid="toast-dismiss"
                className="toast-close-btn"
                aria-label="Dismiss notification"
                onClick={() => dismissToast(toast.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '14px',
                  color: textColors[toast.type] || textColors.info,
                  padding: '0 2px',
                  flexShrink: 0,
                  opacity: 0.7,
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    )}
    <style>{`@keyframes toast-slide-in { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }`}</style>

    {/* ─── Accessible Status Announcements (ARIA live regions) ─── */}
    <div
      data-testid="status-announcer"
      aria-live="polite"
      aria-atomic="true"
      role="status"
      style={{
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 0,
      }}
    >
      {statusAnnouncement}
    </div>
    <div
      data-testid="error-announcer"
      aria-live="assertive"
      aria-atomic="true"
      role="alert"
      style={{
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 0,
      }}
    >
      {errorAnnouncement}
    </div>
    </>
  );
}

const toolbarBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '6px',
  border: '1px solid #e2e8f0',
  backgroundColor: '#f8fafc',
  cursor: 'pointer',
  fontSize: '13px',
  color: '#334155',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 600,
  color: '#64748b',
  marginBottom: '6px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const propInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '4px 6px',
  borderRadius: '4px',
  border: '1px solid #e2e8f0',
  fontSize: '13px',
};

const contextMenuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  padding: '8px 12px',
  fontSize: '13px',
  border: 'none',
  backgroundColor: 'transparent',
  cursor: 'pointer',
  textAlign: 'left',
  color: '#334155',
};
