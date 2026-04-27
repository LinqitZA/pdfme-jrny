import React, { useContext, useState, useEffect } from 'react';
import { Schema, Plugin, BasePdf, getFallbackFontName } from '@pdfme/common';
import { theme, Button } from 'antd';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import Renderer from '../Renderer.js';
import {
  LEFT_SIDEBAR_WIDTH,
  LEFT_SIDEBAR_WIDTH_EXPANDED,
  DESIGNER_CLASSNAME,
} from '../../constants.js';
import { setFontNameRecursively } from '../../helper';
import { OptionsContext, PluginsRegistry } from '../../contexts.js';
import { useFieldPalette } from '../../contexts/FieldPaletteContext.js';
import type { FieldEntry, FieldGroup } from '../../contexts/FieldPaletteContext.js';
import PluginIcon from './PluginIcon.js';

// ---- Plugin Draggable (existing) ----

const Draggable = (props: {
  plugin: Plugin<Schema>;
  scale: number;
  basePdf: BasePdf;
  children: React.ReactNode;
}) => {
  const { scale, basePdf, plugin } = props;
  const { token } = theme.useToken();
  const options = useContext(OptionsContext);
  const defaultSchema = plugin.propPanel.defaultSchema;
  if (options.font) {
    const fontName = getFallbackFontName(options.font);
    setFontNameRecursively(defaultSchema, fontName);
  }
  const draggable = useDraggable({ id: defaultSchema.type, data: defaultSchema });
  const { listeners, setNodeRef, attributes, transform, isDragging } = draggable;
  const style = { transform: CSS.Translate.toString(transform) };

  const renderedSchema = React.useMemo(
    () => (
      <div style={{ transform: `scale(${scale})` }}>
        <Renderer
          schema={{ ...defaultSchema, id: defaultSchema.type }}
          basePdf={basePdf}
          value={defaultSchema.content || ''}
          onChangeHoveringSchemaId={() => {
            void 0;
          }}
          mode={'viewer'}
          outline={`1px solid ${token.colorPrimary}`}
          scale={scale}
        />
      </div>
    ),
    [defaultSchema, basePdf, scale, token.colorPrimary],
  );

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      {isDragging && renderedSchema}
      <div style={{ visibility: isDragging ? 'hidden' : 'visible' }}>{props.children}</div>
    </div>
  );
};

// ---- ERP Field Draggable ----

const FieldDraggable = ({ field, onDragStart }: { field: FieldEntry; onDragStart?: () => void }) => {
  const { token } = theme.useToken();
  const draggable = useDraggable({
    id: `erp-field-${field.key}`,
    data: {
      type: 'text',
      content: `{{${field.key}}}`,
      position: { x: 0, y: 0 },
      width: 50,
      height: 8,
      fieldMeta: {
        label: field.label,
        type: field.type,
        example: field.example,
      },
    },
  });
  const { listeners, setNodeRef, attributes, transform, isDragging } = draggable;
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    padding: '4px 8px',
    margin: '1px 0',
    borderRadius: 4,
    cursor: 'grab',
    fontSize: 12,
    lineHeight: '16px',
    background: isDragging ? token.colorPrimaryBg : 'transparent',
    border: `1px solid ${isDragging ? token.colorPrimary : 'transparent'}`,
    transition: 'background 0.15s, border-color 0.15s',
    userSelect: 'none',
    touchAction: 'none',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      title={field.example ? `Example: ${field.example}` : field.key}
      onMouseDown={() => onDragStart?.()}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = token.colorBgTextHover;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = isDragging
          ? token.colorPrimaryBg
          : 'transparent';
      }}
    >
      <div
        style={{
          fontWeight: 500,
          color: token.colorText,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {field.label}
      </div>
      <div
        style={{
          fontSize: 10,
          color: token.colorTextSecondary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {`{{${field.key}}}`}
      </div>
    </div>
  );
};

// ---- Collapsible Field Group ----

const FieldGroupPanel = ({
  group,
  depth = 0,
  onFieldDragStart,
}: {
  group: FieldGroup;
  depth?: number;
  onFieldDragStart?: () => void;
}) => {
  const { token } = theme.useToken();
  const [expanded, setExpanded] = useState(depth === 0);

  return (
    <div style={{ marginBottom: depth === 0 ? 2 : 0 }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: `3px ${8 + depth * 8}px`,
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 600,
          color: token.colorTextSecondary,
          textTransform: 'uppercase',
          letterSpacing: '0.3px',
          userSelect: 'none',
          background: depth === 0 ? token.colorBgContainer : 'transparent',
          borderBottom: depth === 0 ? `1px solid ${token.colorBorderSecondary}` : 'none',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = token.colorBgTextHover;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.background =
            depth === 0 ? token.colorBgContainer : 'transparent';
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 12,
            fontSize: 10,
            transition: 'transform 0.15s',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          &#9654;
        </span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {group.label}
        </span>
        <span style={{ fontSize: 10, color: token.colorTextQuaternary, fontWeight: 400 }}>
          {group.fields.length}
        </span>
      </div>
      {expanded && (
        <div style={{ paddingLeft: depth * 8 }}>
          {group.fields.map((field) => (
            <FieldDraggable key={field.key} field={field} onDragStart={onFieldDragStart} />
          ))}
          {group.children?.map((child) => (
            <FieldGroupPanel key={child.key} group={child} depth={depth + 1} onFieldDragStart={onFieldDragStart} />
          ))}
        </div>
      )}
    </div>
  );
};

// ---- Section Header ----

const SectionHeader = ({ label }: { label: string }) => {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        padding: '6px 8px 4px',
        fontSize: 10,
        fontWeight: 700,
        color: token.colorTextTertiary,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgLayout,
      }}
    >
      {label}
    </div>
  );
};

// ---- Main LeftSidebar Component ----

const LeftSidebar = ({
  height,
  scale,
  basePdf,
}: {
  height: number;
  scale: number;
  basePdf: BasePdf;
}) => {
  const { token } = theme.useToken();
  const pluginsRegistry = useContext(PluginsRegistry);
  const { fieldGroups, hasFields } = useFieldPalette();
  const [isDragging, setIsDragging] = useState(false);

  const sidebarWidth = hasFields ? LEFT_SIDEBAR_WIDTH_EXPANDED : LEFT_SIDEBAR_WIDTH;

  useEffect(() => {
    const handleMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
      }
    };

    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Narrow sidebar: icons only (original layout)
  if (!hasFields) {
    return (
      <div
        className={DESIGNER_CLASSNAME + 'left-sidebar'}
        style={{
          left: 0,
          right: 0,
          position: 'absolute',
          zIndex: 1,
          height,
          width: sidebarWidth,
          background: token.colorBgLayout,
          textAlign: 'center',
          overflow: isDragging ? 'visible' : 'auto',
        }}
      >
        {pluginsRegistry.entries().map(([label, plugin]) => {
          if (!plugin?.propPanel.defaultSchema) return null;

          const pluginType = plugin.propPanel.defaultSchema.type;

          return (
            <Draggable key={label} scale={scale} basePdf={basePdf} plugin={plugin}>
              <Button
                className={DESIGNER_CLASSNAME + 'plugin-' + pluginType}
                onMouseDown={() => setIsDragging(true)}
                style={{ width: 35, height: 35, marginTop: '0.25rem', padding: '0.25rem' }}
              >
                <PluginIcon plugin={plugin} label={label} />
              </Button>
            </Draggable>
          );
        })}
      </div>
    );
  }

  // Expanded sidebar: schema types + ERP fields
  return (
    <div
      className={DESIGNER_CLASSNAME + 'left-sidebar'}
      style={{
        left: 0,
        right: 0,
        position: 'absolute',
        zIndex: 1,
        height,
        width: sidebarWidth,
        background: token.colorBgLayout,
        overflow: isDragging ? 'visible' : 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Schema Types Section */}
      <SectionHeader label="Schema Types" />
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 2,
          padding: '4px 4px 8px',
          justifyContent: 'center',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        {pluginsRegistry.entries().map(([label, plugin]) => {
          if (!plugin?.propPanel.defaultSchema) return null;

          const pluginType = plugin.propPanel.defaultSchema.type;

          return (
            <Draggable key={label} scale={scale} basePdf={basePdf} plugin={plugin}>
              <Button
                className={DESIGNER_CLASSNAME + 'plugin-' + pluginType}
                onMouseDown={() => setIsDragging(true)}
                style={{ width: 35, height: 35, padding: '0.25rem' }}
              >
                <PluginIcon plugin={plugin} label={label} />
              </Button>
            </Draggable>
          );
        })}
      </div>

      {/* ERP Fields Section */}
      <SectionHeader label="ERP Fields" />
      <div
        style={{
          flex: 1,
          overflowY: isDragging ? 'visible' : 'auto',
          overflowX: isDragging ? 'visible' : 'hidden',
        }}
      >
        {fieldGroups.map((group) => (
          <FieldGroupPanel key={group.key} group={group} onFieldDragStart={() => setIsDragging(true)} />
        ))}
      </div>
    </div>
  );
};

export default LeftSidebar;
