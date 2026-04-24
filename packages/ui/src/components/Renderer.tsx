import React, { useEffect, useContext, ReactNode, useRef, useMemo } from 'react';
import {
  Mode,
  ZOOM,
  UIRenderProps,
  SchemaForUI,
  BasePdf,
  Schema,
  Plugin,
  UIOptions,
  cloneDeep,
} from '@pdfme/common';
import { theme as antdTheme } from 'antd';
import { SELECTABLE_CLASSNAME } from '../constants.js';
import { PluginsRegistry, OptionsContext, I18nContext, CacheContext } from '../contexts.js';

type RendererProps = Omit<
  UIRenderProps<Schema>,
  'schema' | 'rootElement' | 'options' | 'theme' | 'i18n' | '_cache'
> & {
  basePdf: BasePdf;
  schema: SchemaForUI;
  value: string;
  outline: string;
  onChangeHoveringSchemaId?: (id: string | null) => void;
  scale: number;
  selectable?: boolean;
};

type ReRenderCheckProps = {
  plugin?: Plugin<Schema>;
  value: string;
  mode: Mode;
  scale: number;
  schema: SchemaForUI;
  options: UIOptions;
};

const useRerenderDependencies = (arg: ReRenderCheckProps) => {
  const { plugin, value, mode, scale, schema, options } = arg;
  const _options = cloneDeep(options);
  if (_options.font) {
    Object.values(_options.font).forEach((fontObj) => {
      (fontObj as { data: string }).data = '...';
    });
  }
  const optionStr = JSON.stringify(_options);

  return useMemo(() => {
    if (plugin?.uninterruptedEditMode && mode === 'designer') {
      return [mode];
    } else {
      return [value, mode, scale, JSON.stringify(schema), optionStr];
    }
  }, [value, mode, scale, schema, optionStr, plugin]);
};

const Wrapper = ({
  children,
  outline,
  onChangeHoveringSchemaId,
  schema,
  mode,
  selectable = true,
}: RendererProps & { children: ReactNode }) => {
  const { token } = antdTheme.useToken();
  const isEditing = mode === 'designer';
  const hasContent = !!(schema as any).content;

  return (
    <div
      title={schema.name}
      onMouseEnter={() => onChangeHoveringSchemaId && onChangeHoveringSchemaId(schema.id)}
      onMouseLeave={() => onChangeHoveringSchemaId && onChangeHoveringSchemaId(null)}
      className={selectable ? SELECTABLE_CLASSNAME : ''}
      id={schema.id}
      style={{
        position: 'absolute',
        cursor: schema.readOnly ? 'initial' : 'pointer',
        height: schema.height * ZOOM,
        width: schema.width * ZOOM,
        top: schema.position.y * ZOOM,
        left: schema.position.x * ZOOM,
        transform: `rotate(${schema.rotate ?? 0}deg)`,
        opacity: schema.opacity ?? 1,
        outline,
      }}
    >
      {/* Schema name label — shows field name tag above each element */}
      {schema.name && !isEditing && (
        <div
          style={{
            position: 'absolute',
            top: -16,
            left: 0,
            fontSize: 9,
            lineHeight: '14px',
            padding: '0 4px',
            backgroundColor: hasContent ? token.colorPrimary : '#94a3b8',
            color: '#fff',
            borderRadius: '2px 2px 0 0',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: schema.width * ZOOM,
            pointerEvents: 'none',
            zIndex: 1,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            letterSpacing: '0.01em',
          }}
        >
          {schema.name}
        </div>
      )}
      {/* Empty content placeholder — shows type hint when element has no content */}
      {!hasContent && !isEditing && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#94a3b8',
            fontSize: 10,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            pointerEvents: 'none',
            backgroundColor: 'rgba(241, 245, 249, 0.5)',
            zIndex: 0,
          }}
        >
          {schema.type}
        </div>
      )}
      {schema.required && (
        <span
          style={{
            color: 'red',
            position: 'absolute',
            top: -12,
            left: -12,
            fontSize: 18,
            fontWeight: 700,
          }}
        >
          *
        </span>
      )}
      {/* Page scope badge — shows when element has non-default page visibility */}
      {(() => {
        const pageScope = (schema as Record<string, unknown>).pageScope as string | undefined;
        if (!pageScope || pageScope === 'all') return null;
        const scopeLabels: Record<string, string> = {
          first: 'P1',
          last: 'Pn',
          notFirst: 'P2+',
        };
        const scopeColors: Record<string, string> = {
          first: '#1677ff',
          last: '#fa8c16',
          notFirst: '#52c41a',
        };
        const label = scopeLabels[pageScope] || pageScope;
        const bgColor = scopeColors[pageScope] || '#1677ff';
        return (
          <div
            title={`Page: ${pageScope === 'first' ? 'First Only' : pageScope === 'last' ? 'Last Only' : pageScope === 'notFirst' ? 'Not First' : pageScope}`}
            style={{
              position: 'absolute',
              top: -16,
              right: 0,
              fontSize: 8,
              lineHeight: '14px',
              padding: '0 3px',
              backgroundColor: bgColor,
              color: '#fff',
              borderRadius: '2px 2px 0 0',
              pointerEvents: 'none',
              zIndex: 1,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontWeight: 600,
              letterSpacing: '0.02em',
            }}
          >
            {label}
          </div>
        );
      })()}
      {/* Output channel badge — shows when element has non-default output channel */}
      {(() => {
        const outputChannel = (schema as Record<string, unknown>).outputChannel as string | undefined;
        if (!outputChannel || outputChannel === 'both') return null;
        const channelLabels: Record<string, string> = {
          email: '✉',
          print: '⎙',
        };
        const channelColors: Record<string, string> = {
          email: '#722ed1',
          print: '#d48806',
        };
        const label = channelLabels[outputChannel] || outputChannel;
        const bgColor = channelColors[outputChannel] || '#722ed1';
        const hasPageScope = !!((schema as Record<string, unknown>).pageScope as string | undefined) &&
          (schema as Record<string, unknown>).pageScope !== 'all';
        return (
          <div
            title={`Output: ${outputChannel === 'email' ? 'Email Only' : outputChannel === 'print' ? 'Print Only' : outputChannel}`}
            style={{
              position: 'absolute',
              top: -16,
              right: hasPageScope ? 28 : 0,
              fontSize: 9,
              lineHeight: '14px',
              padding: '0 3px',
              backgroundColor: bgColor,
              color: '#fff',
              borderRadius: '2px 2px 0 0',
              pointerEvents: 'none',
              zIndex: 1,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontWeight: 600,
            }}
          >
            {label}
          </div>
        );
      })()}
      {children}
    </div>
  );
};

const Renderer = (props: RendererProps) => {
  const { schema, basePdf, value, mode, onChange, stopEditing, tabIndex, placeholder, scale } =
    props;

  const pluginsRegistry = useContext(PluginsRegistry);
  const options = useContext(OptionsContext);
  const i18n = useContext(I18nContext) as (key: string) => string;
  const { token: theme } = antdTheme.useToken();

  const ref = useRef<HTMLDivElement>(null);
  const _cache = useContext(CacheContext);
  const plugin = pluginsRegistry.findByType(schema.type);

  const reRenderDependencies = useRerenderDependencies({
    plugin,
    value,
    mode,
    scale,
    schema,
    options,
  });

  useEffect(() => {
    if (!plugin?.ui || !ref.current || !schema.type) return;

    ref.current.innerHTML = '';
    const render = plugin.ui;

    void render({
      value,
      schema,
      basePdf,
      rootElement: ref.current,
      mode,
      onChange,
      stopEditing,
      tabIndex,
      placeholder,
      options,
      theme,
      i18n,
      scale,
      _cache,
    });

    return () => {
      if (ref.current) {
        ref.current.innerHTML = '';
      }
    };
  }, reRenderDependencies);

  if (!plugin) {
    console.error(`[@pdfme/ui] Renderer for type ${schema.type} not found. 
Check this document: https://pdfme.com/docs/custom-schemas`);
    return <></>;
  }

  return (
    <Wrapper {...props}>
      <div style={{ height: '100%', width: '100%' }} ref={ref} />
    </Wrapper>
  );
};
export default Renderer;
