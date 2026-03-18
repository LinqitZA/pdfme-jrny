'use client';

import React, { useState, useCallback } from 'react';

/**
 * ErpDesigner - Three-panel WYSIWYG template designer for ERP documents.
 *
 * Layout:
 *   [Left Panel: Blocks/Fields/Assets/Pages tabs]
 *   [Center Canvas: A4 template preview with rulers]
 *   [Right Panel: Properties panel]
 *
 * Toolbar: template name, page size, undo/redo, zoom, preview, save, publish
 */

export interface ErpDesignerProps {
  templateId?: string;
  templateName?: string;
  orgId?: string;
  onSave?: (template: unknown) => void;
  onChange?: (template: unknown) => void;
}

type LeftTab = 'blocks' | 'fields' | 'assets' | 'pages';

const BLOCK_CATEGORIES = [
  {
    name: 'Content',
    blocks: [
      { id: 'text', label: 'Text', icon: 'T' },
      { id: 'rich-text', label: 'Rich Text', icon: 'Rt' },
      { id: 'calculated', label: 'Calculated Field', icon: 'fx' },
    ],
  },
  {
    name: 'Media',
    blocks: [
      { id: 'image', label: 'Image', icon: 'Img' },
      { id: 'erp-image', label: 'ERP Image', icon: 'EI' },
      { id: 'signature', label: 'Signature Block', icon: 'Sig' },
      { id: 'drawn-signature', label: 'Drawn Signature', icon: 'DS' },
    ],
  },
  {
    name: 'Data',
    blocks: [
      { id: 'line-items', label: 'Line Items Table', icon: 'LI' },
      { id: 'grouped-table', label: 'Grouped Table', icon: 'GT' },
      { id: 'qr-barcode', label: 'QR/Barcode', icon: 'QR' },
    ],
  },
  {
    name: 'Layout',
    blocks: [
      { id: 'watermark', label: 'Watermark', icon: 'Wm' },
    ],
  },
];

const PAGE_SIZES = ['A4', 'Letter', 'Legal', 'A3', 'A5'];
const ZOOM_LEVELS = [25, 50, 75, 100, 125, 150, 200];

export default function ErpDesigner({
  templateName = 'Untitled Template',
  onSave,
}: ErpDesignerProps) {
  const [activeTab, setActiveTab] = useState<LeftTab>('blocks');
  const [zoom, setZoom] = useState(100);
  const [pageSize, setPageSize] = useState('A4');
  const [name, setName] = useState(templateName);
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const handleSave = useCallback(() => {
    if (onSave) {
      onSave({ name, pageSize, schemas: [] });
    }
    setIsDirty(false);
  }, [name, pageSize, onSave]);

  return (
    <div
      className="erp-designer"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#1a1a2e',
        backgroundColor: '#f8f9fa',
      }}
    >
      {/* ─── Toolbar ─── */}
      <div
        className="erp-designer-toolbar"
        data-testid="designer-toolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '8px 16px',
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          minHeight: '48px',
          flexShrink: 0,
        }}
      >
        {/* Template Name (inline editable) */}
        <input
          data-testid="template-name-input"
          value={name}
          onChange={(e) => { setName(e.target.value); setIsDirty(true); }}
          style={{
            border: 'none',
            fontSize: '14px',
            fontWeight: 600,
            padding: '4px 8px',
            borderRadius: '4px',
            backgroundColor: 'transparent',
            width: '200px',
          }}
          onFocus={(e) => e.target.style.backgroundColor = '#f1f5f9'}
          onBlur={(e) => e.target.style.backgroundColor = 'transparent'}
        />

        <div style={{ width: '1px', height: '24px', backgroundColor: '#e2e8f0' }} />

        {/* Page Size Selector */}
        <select
          data-testid="page-size-selector"
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
        <button data-testid="btn-undo" title="Undo" style={toolbarBtnStyle} disabled>↩</button>
        <button data-testid="btn-redo" title="Redo" style={toolbarBtnStyle} disabled>↪</button>

        <div style={{ width: '1px', height: '24px', backgroundColor: '#e2e8f0' }} />

        {/* Zoom Control */}
        <select
          data-testid="zoom-selector"
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

        <div style={{ flex: 1 }} />

        {/* Right-side actions */}
        <button data-testid="btn-preview" style={toolbarBtnStyle}>Preview</button>
        <button
          data-testid="btn-save"
          onClick={handleSave}
          style={{
            ...toolbarBtnStyle,
            backgroundColor: isDirty ? '#3b82f6' : '#94a3b8',
            color: '#fff',
            fontWeight: 600,
          }}
        >
          Save Draft
        </button>
        <button
          data-testid="btn-publish"
          style={{
            ...toolbarBtnStyle,
            backgroundColor: '#10b981',
            color: '#fff',
            fontWeight: 600,
          }}
        >
          Publish
        </button>
      </div>

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
        {/* ─── Left Panel ─── */}
        <div
          className="erp-designer-left-panel"
          data-testid="left-panel"
          style={{
            width: '260px',
            backgroundColor: '#ffffff',
            borderRight: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
          }}
        >
          {/* Tabs */}
          <div
            data-testid="left-panel-tabs"
            style={{
              display: 'flex',
              borderBottom: '1px solid #e2e8f0',
            }}
          >
            {(['blocks', 'fields', 'assets', 'pages'] as LeftTab[]).map((tab) => (
              <button
                key={tab}
                data-testid={`tab-${tab}`}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1,
                  padding: '10px 4px',
                  fontSize: '12px',
                  fontWeight: activeTab === tab ? 600 : 400,
                  color: activeTab === tab ? '#3b82f6' : '#64748b',
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
          </div>

          {/* Tab Content */}
          <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
            {activeTab === 'blocks' && (
              <div data-testid="blocks-content">
                {BLOCK_CATEGORIES.map((cat) => (
                  <div key={cat.name} style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '8px' }}>
                      {cat.name}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                      {cat.blocks.map((block) => (
                        <div
                          key={block.id}
                          data-testid={`block-${block.id}`}
                          draggable
                          style={{
                            padding: '8px',
                            borderRadius: '6px',
                            border: '1px solid #e2e8f0',
                            backgroundColor: '#f8fafc',
                            cursor: 'grab',
                            textAlign: 'center',
                            fontSize: '11px',
                          }}
                        >
                          <div style={{ fontSize: '16px', marginBottom: '2px' }}>{block.icon}</div>
                          {block.label}
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
                  placeholder="Search fields..."
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
                  <div style={{ fontWeight: 600, marginBottom: '4px' }}>Document</div>
                  <div style={{ paddingLeft: '12px', marginBottom: '2px', cursor: 'pointer' }}>{'{{document.number}}'}</div>
                  <div style={{ paddingLeft: '12px', marginBottom: '2px', cursor: 'pointer' }}>{'{{document.date}}'}</div>
                  <div style={{ paddingLeft: '12px', marginBottom: '8px', cursor: 'pointer' }}>{'{{document.dueDate}}'}</div>
                  <div style={{ fontWeight: 600, marginBottom: '4px' }}>Customer</div>
                  <div style={{ paddingLeft: '12px', marginBottom: '2px', cursor: 'pointer' }}>{'{{customer.name}}'}</div>
                  <div style={{ paddingLeft: '12px', marginBottom: '2px', cursor: 'pointer' }}>{'{{customer.email}}'}</div>
                  <div style={{ paddingLeft: '12px', marginBottom: '2px', cursor: 'pointer' }}>{'{{customer.address}}'}</div>
                </div>
              </div>
            )}
            {activeTab === 'assets' && (
              <div data-testid="assets-content">
                <button style={{ ...toolbarBtnStyle, width: '100%', marginBottom: '12px' }}>
                  Upload Asset
                </button>
                <div style={{ fontSize: '13px', color: '#94a3b8', textAlign: 'center', padding: '20px 0' }}>
                  No assets uploaded yet
                </div>
              </div>
            )}
            {activeTab === 'pages' && (
              <div data-testid="pages-content">
                <div
                  style={{
                    padding: '8px',
                    border: '2px solid #3b82f6',
                    borderRadius: '6px',
                    backgroundColor: '#f1f5f9',
                    textAlign: 'center',
                    fontSize: '12px',
                    marginBottom: '8px',
                  }}
                >
                  <div style={{ width: '100%', height: '80px', backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '4px', marginBottom: '4px' }} />
                  Page 1
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Center Canvas ─── */}
        <div
          className="erp-designer-canvas"
          data-testid="center-canvas"
          style={{
            flex: 1,
            backgroundColor: '#e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'auto',
            padding: '24px',
          }}
          onClick={() => setSelectedElement(null)}
        >
          {/* A4 Page */}
          <div
            data-testid="canvas-page"
            style={{
              width: `${595 * (zoom / 100)}px`,
              height: `${842 * (zoom / 100)}px`,
              backgroundColor: '#ffffff',
              boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
              borderRadius: '2px',
              position: 'relative',
              transition: 'width 0.2s, height 0.2s',
            }}
          >
            {/* Placeholder content showing it's a template canvas */}
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
              Drag blocks here to design your template
            </div>
          </div>
        </div>

        {/* ─── Right Properties Panel ─── */}
        <div
          className="erp-designer-right-panel"
          data-testid="right-panel"
          style={{
            width: '280px',
            backgroundColor: '#ffffff',
            borderLeft: '1px solid #e2e8f0',
            display: 'flex',
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
            }}
          >
            Properties
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
            {selectedElement ? (
              <div data-testid="properties-content">
                <div style={{ marginBottom: '16px' }}>
                  <label style={labelStyle}>Position &amp; Size</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <div><span style={{ fontSize: '11px', color: '#94a3b8' }}>X</span><input style={propInputStyle} defaultValue="0" /></div>
                    <div><span style={{ fontSize: '11px', color: '#94a3b8' }}>Y</span><input style={propInputStyle} defaultValue="0" /></div>
                    <div><span style={{ fontSize: '11px', color: '#94a3b8' }}>W</span><input style={propInputStyle} defaultValue="100" /></div>
                    <div><span style={{ fontSize: '11px', color: '#94a3b8' }}>H</span><input style={propInputStyle} defaultValue="20" /></div>
                  </div>
                </div>
              </div>
            ) : (
              <div
                data-testid="properties-empty"
                style={{
                  textAlign: 'center',
                  color: '#94a3b8',
                  fontSize: '13px',
                  padding: '40px 20px',
                }}
              >
                Select an element on the canvas to edit its properties
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
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
};

const propInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '4px 6px',
  borderRadius: '4px',
  border: '1px solid #e2e8f0',
  fontSize: '13px',
};
