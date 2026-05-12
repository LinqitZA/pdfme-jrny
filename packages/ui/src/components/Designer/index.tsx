import React, { useRef, useState, useContext, useCallback, useEffect } from 'react';
import {
  cloneDeep,
  ZOOM,
  Template,
  Schema,
  SchemaForUI,
  ChangeSchemas,
  DesignerProps,
  Size,
  BasePdf,
  BlankPdf,
  isBlankPdf,
  px2mm,
} from '@pdfme/common';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import RightSidebar from './RightSidebar/index.js';
import LeftSidebar from './LeftSidebar.js';
import Canvas from './Canvas/index.js';
import { RULER_HEIGHT, RIGHT_SIDEBAR_WIDTH, LEFT_SIDEBAR_WIDTH, LEFT_SIDEBAR_WIDTH_EXPANDED } from '../../constants.js';
import { I18nContext, OptionsContext, PluginsRegistry } from '../../contexts.js';
import { useFieldPalette } from '../../contexts/FieldPaletteContext.js';
import { GridContext, DEFAULT_GRID_SIZE_MM } from '../../contexts/GridContext.js';
import type { GridSizeMm } from '../../contexts/GridContext.js';
import {
  schemasList2template,
  uuid,
  round,
  template2SchemasList,
  getPagesScrollTopByIndex,
  changeSchemas as _changeSchemas,
  useMaxZoom,
} from '../../helper.js';
import { useUIPreProcessor, useScrollPageCursor, useInitEvents } from '../../hooks.js';
import { theme } from 'antd';
import Root from '../Root.js';
import ErrorScreen from '../ErrorScreen.js';
import CtlBar from '../CtlBar.js';

/**
 * When the canvas scales there is a displacement of the starting position of the dragged schema.
 * It moves left or right from the top-left corner of the drag icon depending on the scale.
 * This function calculates the adjustment needed to compensate for this displacement.
 */
const scaleDragPosAdjustment = (adjustment: number, scale: number): number => {
  if (scale > 1) return adjustment * (scale - 1);
  if (scale < 1) return adjustment * -(1 - scale);
  return 0;
};

const TemplateEditor = ({
  template,
  size,
  onSaveTemplate,
  onChangeTemplate,
  onPageCursorChange,
}: Omit<DesignerProps, 'domContainer'> & {
  size: Size;
  onSaveTemplate: (t: Template) => void;
  onChangeTemplate: (t: Template) => void;
} & {
  onChangeTemplate: (t: Template) => void;
  onPageCursorChange: (newPageCursor: number, totalPages: number) => void;
}) => {
  const past = useRef<SchemaForUI[][]>([]);
  const future = useRef<SchemaForUI[][]>([]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const paperRefs = useRef<HTMLDivElement[]>([]);

  const i18n = useContext(I18nContext);
  const pluginsRegistry = useContext(PluginsRegistry);
  const options = useContext(OptionsContext);
  const { hasFields } = useFieldPalette();
  const { token } = theme.useToken();
  const maxZoom = useMaxZoom();

  const leftSidebarWidth = hasFields ? LEFT_SIDEBAR_WIDTH_EXPANDED : LEFT_SIDEBAR_WIDTH;

  const [hoveringSchemaId, setHoveringSchemaId] = useState<string | null>(null);
  const [activeElements, setActiveElements] = useState<HTMLElement[]>([]);
  const [schemasList, setSchemasList] = useState<SchemaForUI[][]>([[]] as SchemaForUI[][]);
  const [pageCursor, setPageCursor] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(options.zoomLevel ?? 1);
  const [gridSizeMm, setGridSizeMm] = useState<GridSizeMm>(DEFAULT_GRID_SIZE_MM);
  const [sidebarOpen, setSidebarOpen] = useState(options.sidebarOpen ?? true);
  const [activeDragData, setActiveDragData] = useState<Record<string, unknown> | null>(null);
  const [currentBasePdf, setCurrentBasePdf] = useState<BasePdf>(template.basePdf);

  // Track whether a template change originated from within the Designer
  // (e.g., delete, move, resize). When true, the useEffect that watches the
  // template prop will skip calling updateTemplate, preventing deleted fields
  // from reappearing due to an async re-parse race condition.
  const internalChangeRef = useRef(false);
  // Content-based tracking to detect actual external template changes
  const prevSchemasContentRef = useRef<string>('');
  const prevBasePdfContentRef = useRef<string>('');

  const { backgrounds, pageSizes, scale, error, refresh } = useUIPreProcessor({
    template,
    size,
    zoomLevel,
    maxZoom,
  });

  const onEdit = (targets: HTMLElement[]) => {
    setActiveElements(targets);
    setHoveringSchemaId(null);
  };

  const onEditEnd = () => {
    setActiveElements([]);
    setHoveringSchemaId(null);
  };

  // Update component state only when _options_ changes
  // Ignore exhaustive useEffect dependency warnings here
  useEffect(() => {
    if (typeof options.zoomLevel === 'number' && options.zoomLevel !== zoomLevel) {
      setZoomLevel(options.zoomLevel);
    }
    if (typeof options.sidebarOpen === 'boolean' && options.sidebarOpen !== sidebarOpen) {
      setSidebarOpen(options.sidebarOpen);
    }
    // eslint-disable-next-line
  }, [options]);

  useScrollPageCursor({
    ref: canvasRef,
    pageSizes,
    scale,
    pageCursor,
    onChangePageCursor: (p) => {
      setPageCursor(p);
      onPageCursorChange(p, schemasList.length);
      onEditEnd();
    },
  });

  const commitSchemas = useCallback(
    (newSchemas: SchemaForUI[]) => {
      future.current = [];
      past.current.push(cloneDeep(schemasList[pageCursor]));
      const _schemasList = cloneDeep(schemasList);
      _schemasList[pageCursor] = newSchemas;
      setSchemasList(_schemasList);
      internalChangeRef.current = true;
      onChangeTemplate(schemasList2template(_schemasList, currentBasePdf));
    },
    [currentBasePdf, schemasList, pageCursor, onChangeTemplate],
  );

  const removeSchemas = useCallback(
    (ids: string[]) => {
      commitSchemas(schemasList[pageCursor].filter((schema) => !ids.includes(schema.id)));
      onEditEnd();
    },
    [schemasList, pageCursor, commitSchemas],
  );

  const changeSchemas: ChangeSchemas = useCallback(
    (objs) => {
      _changeSchemas({
        objs,
        schemas: schemasList[pageCursor],
        basePdf: currentBasePdf,
        pluginsRegistry,
        pageSize: pageSizes[pageCursor],
        commitSchemas,
      });
    },
    [commitSchemas, pageCursor, schemasList, pluginsRegistry, pageSizes, currentBasePdf],
  );

  useInitEvents({
    pageCursor,
    pageSizes,
    activeElements,
    template,
    schemasList,
    changeSchemas,
    commitSchemas,
    removeSchemas,
    onSaveTemplate,
    past,
    future,
    setSchemasList,
    onEdit,
    onEditEnd,
  });

  const updateTemplate = useCallback(async (newTemplate: Template, resetCursor = false) => {
    const sl = await template2SchemasList(newTemplate);
    setSchemasList(sl);
    onEditEnd();
    if (resetCursor) {
      setPageCursor(0);
      if (canvasRef.current?.scroll) {
        canvasRef.current.scroll({ top: 0, behavior: 'smooth' });
      }
    }
  }, []);

  const addSchema = (defaultSchema: Schema) => {
    const [paddingTop, paddingRight, paddingBottom, paddingLeft] = isBlankPdf(currentBasePdf)
      ? currentBasePdf.padding
      : [0, 0, 0, 0];
    const pageSize = pageSizes[pageCursor];

    const newSchemaName = (prefix: string) => {
      let index = schemasList.reduce((acc, page) => acc + page.length, 1);
      let newName = prefix + index;
      while (schemasList.some((page) => page.find((s) => s.name === newName))) {
        index++;
        newName = prefix + index;
      }
      return newName;
    };
    const ensureMiddleValue = (min: number, value: number, max: number) =>
      Math.min(Math.max(min, value), max);

    const s = {
      id: uuid(),
      ...defaultSchema,
      name: newSchemaName(i18n('field')),
      position: {
        x: ensureMiddleValue(
          paddingLeft,
          defaultSchema.position.x,
          pageSize.width - paddingRight - defaultSchema.width,
        ),
        y: ensureMiddleValue(
          paddingTop,
          defaultSchema.position.y,
          pageSize.height - paddingBottom - defaultSchema.height,
        ),
      },
      required: defaultSchema.readOnly
        ? false
        : options.requiredByDefault || defaultSchema.required || false,
    } as SchemaForUI;

    if (defaultSchema.position.y === 0) {
      const paper = paperRefs.current[pageCursor];
      const rectTop = paper ? paper.getBoundingClientRect().top : 0;
      s.position.y = rectTop > 0 ? paddingTop : pageSizes[pageCursor].height / 2;
    }

    commitSchemas(schemasList[pageCursor].concat(s));
    setTimeout(() => onEdit([document.getElementById(s.id)!]));
  };

  const onSortEnd = (sortedSchemas: SchemaForUI[]) => {
    commitSchemas(sortedSchemas);
  };

  const onChangeHoveringSchemaId = (id: string | null) => {
    setHoveringSchemaId(id);
  };

  const updatePage = async (sl: SchemaForUI[][], newPageCursor: number) => {
    setPageCursor(newPageCursor);
    const newTemplate = schemasList2template(sl, currentBasePdf);
    internalChangeRef.current = true;
    onChangeTemplate(newTemplate);
    await updateTemplate(newTemplate);
    void refresh(newTemplate);
    
    // Notify page change with updated total pages
    onPageCursorChange(newPageCursor, sl.length);

    // Use setTimeout to update scroll position after render
    setTimeout(() => {
      if (canvasRef.current) {
        canvasRef.current.scrollTop = getPagesScrollTopByIndex(pageSizes, newPageCursor, scale);
      }
    }, 0);
  };

  const handleRemovePage = () => {
    if (pageCursor === 0) return;
    if (!window.confirm(i18n('removePageConfirm'))) return;

    const _schemasList = cloneDeep(schemasList);
    _schemasList.splice(pageCursor, 1);
    void updatePage(_schemasList, pageCursor - 1);
  };

  const handleAddPageAfter = () => {
    const _schemasList = cloneDeep(schemasList);
    _schemasList.splice(pageCursor + 1, 0, []);
    void updatePage(_schemasList, pageCursor + 1);
  };

  // Detect external template changes (e.g., parent loading a new template) using
  // content-based comparison. Internal changes (delete, move, resize) set
  // internalChangeRef to skip re-processing when the template prop bounces back.
  useEffect(() => {
    const schemasContent = JSON.stringify(template.schemas);
    const basePdfContent = JSON.stringify(template.basePdf);

    // If this change originated from within the Designer, just update tracking
    // refs and skip updateTemplate to prevent deleted fields from reappearing.
    if (internalChangeRef.current) {
      internalChangeRef.current = false;
      prevSchemasContentRef.current = schemasContent;
      prevBasePdfContentRef.current = basePdfContent;
      return;
    }

    // Only process if template content actually changed (external change)
    if (schemasContent !== prevSchemasContentRef.current || basePdfContent !== prevBasePdfContentRef.current) {
      prevSchemasContentRef.current = schemasContent;
      prevBasePdfContentRef.current = basePdfContent;
      setCurrentBasePdf(template.basePdf);
      void updateTemplate(template, true);
    }
  }, [template, updateTemplate]);

  const canvasWidth = size.width - leftSidebarWidth;
  const sizeExcSidebars = {
    width: sidebarOpen ? canvasWidth - RIGHT_SIDEBAR_WIDTH : canvasWidth,
    height: size.height,
  };

  if (error) {
    // Pass the error directly to ErrorScreen
    return <ErrorScreen size={size} error={error} />;
  }
  const pageManipulation = isBlankPdf(currentBasePdf)
    ? { addPageAfter: handleAddPageAfter, removePage: handleRemovePage }
    : {};

  /**
   * Handles page size changes from the CtlBar page size selector or orientation toggle.
   * Updates basePdf width/height, swaps padding if orientation changes,
   * repositions elements that fall outside new bounds, and re-renders the template.
   */
  const handlePageSizeChange = useCallback(
    (newWidth: number, newHeight: number) => {
      if (!isBlankPdf(currentBasePdf)) return;

      const oldBasePdf = currentBasePdf;
      const oldIsPortrait = oldBasePdf.height > oldBasePdf.width;
      const newIsPortrait = newHeight > newWidth;
      const orientationChanged = oldIsPortrait !== newIsPortrait;

      // Swap padding when orientation changes: [top, right, bottom, left] → rotated
      const newPadding: [number, number, number, number] = orientationChanged
        ? [oldBasePdf.padding[3], oldBasePdf.padding[0], oldBasePdf.padding[1], oldBasePdf.padding[2]]
        : oldBasePdf.padding;

      const newBasePdf: BlankPdf = {
        ...oldBasePdf,
        width: newWidth,
        height: newHeight,
        padding: newPadding,
      };

      // Update local basePdf state so the UI reflects the change immediately
      setCurrentBasePdf(newBasePdf);

      // Reposition elements that fall outside the new page boundaries
      const [paddingTop, paddingRight, paddingBottom, paddingLeft] = newBasePdf.padding;
      const maxX = newWidth - paddingRight;
      const maxY = newHeight - paddingBottom;

      const adjustedSchemasList = schemasList.map((pageSchemas) =>
        pageSchemas.map((schema) => {
          const adjusted = { ...schema };
          // Ensure element doesn't extend past right edge
          if (adjusted.position.x + adjusted.width > maxX) {
            adjusted.position = {
              ...adjusted.position,
              x: Math.max(paddingLeft, maxX - adjusted.width),
            };
          }
          // Ensure element doesn't extend past bottom edge
          if (adjusted.position.y + adjusted.height > maxY) {
            adjusted.position = {
              ...adjusted.position,
              y: Math.max(paddingTop, maxY - adjusted.height),
            };
          }
          return adjusted;
        }),
      );

      const newTemplate = schemasList2template(adjustedSchemasList, newBasePdf);
      internalChangeRef.current = true;
      onChangeTemplate(newTemplate);
      void updateTemplate(newTemplate).then(() => refresh(newTemplate));
    },
    [currentBasePdf, schemasList, onChangeTemplate, updateTemplate, refresh],
  );

  /**
   * Handles padding changes from the RightSidebar page settings panel.
   * Updates basePdf padding and repositions elements that fall outside new bounds.
   */
  const handlePaddingChange = useCallback(
    (newPadding: [number, number, number, number]) => {
      if (!isBlankPdf(currentBasePdf)) return;

      const oldBasePdf = currentBasePdf;
      const newBasePdf: BlankPdf = {
        ...oldBasePdf,
        padding: newPadding,
      };

      // Update local basePdf state so the UI reflects the change immediately
      setCurrentBasePdf(newBasePdf);

      // Reposition elements that fall outside the new padded boundaries
      const [pTop, pRight, pBottom, pLeft] = newPadding;
      const maxX = oldBasePdf.width - pRight;
      const maxY = oldBasePdf.height - pBottom;

      const adjustedSchemasList = schemasList.map((pageSchemas) =>
        pageSchemas.map((schema) => {
          const adjusted = { ...schema };
          // Ensure element is within left padding
          if (adjusted.position.x < pLeft) {
            adjusted.position = { ...adjusted.position, x: pLeft };
          }
          // Ensure element is within top padding
          if (adjusted.position.y < pTop) {
            adjusted.position = { ...adjusted.position, y: pTop };
          }
          // Ensure element doesn't extend past right edge
          if (adjusted.position.x + adjusted.width > maxX) {
            adjusted.position = {
              ...adjusted.position,
              x: Math.max(pLeft, maxX - adjusted.width),
            };
          }
          // Ensure element doesn't extend past bottom edge
          if (adjusted.position.y + adjusted.height > maxY) {
            adjusted.position = {
              ...adjusted.position,
              y: Math.max(pTop, maxY - adjusted.height),
            };
          }
          return adjusted;
        }),
      );

      const newTemplate = schemasList2template(adjustedSchemasList, newBasePdf);
      internalChangeRef.current = true;
      onChangeTemplate(newTemplate);
      // Update schemas list from new template without resetting page cursor
      void template2SchemasList(newTemplate).then((sl) => {
        setSchemasList(sl);
        refresh(newTemplate);
      });
    },
    [currentBasePdf, schemasList, onChangeTemplate, refresh],
  );

  // Page size props for CtlBar (only for blank PDFs)
  const pageSizeProps = isBlankPdf(currentBasePdf)
    ? {
        currentPageWidth: currentBasePdf.width,
        currentPageHeight: currentBasePdf.height,
        onPageSizeChange: handlePageSizeChange,
      }
    : {};

  const gridContextValue = { gridSizeMm };

  return (
    <Root size={size} scale={scale}>
      <GridContext.Provider value={gridContextValue}>
      <DndContext
        onDragEnd={(event) => {
          setActiveDragData(null);
          // Triggered after a schema is dragged & dropped from the left sidebar.
          if (!event.active) return;
          const active = event.active;
          const pageRect = paperRefs.current[pageCursor].getBoundingClientRect();

          const dragStartLeft = active.rect.current.initial?.left || 0;
          const dragStartTop = active.rect.current.initial?.top || 0;

          const canvasLeftOffsetFromPageCorner =
            pageRect.left - dragStartLeft + scaleDragPosAdjustment(20, scale);
          const canvasTopOffsetFromPageCorner = pageRect.top - dragStartTop;

          const moveY = (event.delta.y - canvasTopOffsetFromPageCorner) / scale;
          const moveX = (event.delta.x - canvasLeftOffsetFromPageCorner) / scale;

          const position = {
            x: round(px2mm(Math.max(0, moveX)), 2),
            y: round(px2mm(Math.max(0, moveY)), 2),
          };

          addSchema({ ...(active.data.current as Schema), position });
        }}
        onDragStart={(event) => {
          onEditEnd();
          setActiveDragData((event.active.data.current ?? null) as Record<string, unknown> | null);
        }}
        onDragCancel={() => setActiveDragData(null)}
      >
        <LeftSidebar
          height={canvasRef.current ? canvasRef.current.clientHeight : 0}
          scale={scale}
          basePdf={currentBasePdf}
        />

        <div style={{ position: 'absolute', width: canvasWidth, marginLeft: leftSidebarWidth }}>
          <CtlBar
            size={sizeExcSidebars}
            pageCursor={pageCursor}
            pageNum={schemasList.length}
            setPageCursor={(p) => {
              if (!canvasRef.current) return;
              // Update scroll position and state
              canvasRef.current.scrollTop = getPagesScrollTopByIndex(pageSizes, p, scale);
              setPageCursor(p);
              onPageCursorChange(p, schemasList.length);
              onEditEnd();
            }}
            zoomLevel={zoomLevel}
            setZoomLevel={setZoomLevel}
            gridSizeMm={gridSizeMm}
            setGridSizeMm={setGridSizeMm}
            {...pageManipulation}
            {...pageSizeProps}
          />

          <RightSidebar
            hoveringSchemaId={hoveringSchemaId}
            onChangeHoveringSchemaId={onChangeHoveringSchemaId}
            height={canvasRef.current ? canvasRef.current.clientHeight : 0}
            size={size}
            pageSize={pageSizes[pageCursor] ?? []}
            basePdf={currentBasePdf}
            activeElements={activeElements}
            schemasList={schemasList}
            schemas={schemasList[pageCursor] ?? []}
            changeSchemas={changeSchemas}
            onSortEnd={onSortEnd}
            onEdit={(id) => {
              const editingElem = document.getElementById(id);
              if (editingElem) {
                onEdit([editingElem]);
              }
            }}
            onEditEnd={onEditEnd}
            deselectSchema={onEditEnd}
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
            onPageSizeChange={isBlankPdf(currentBasePdf) ? handlePageSizeChange : undefined}
            onPaddingChange={isBlankPdf(currentBasePdf) ? handlePaddingChange : undefined}
          />

          <Canvas
            ref={canvasRef}
            paperRefs={paperRefs}
            basePdf={currentBasePdf}
            hoveringSchemaId={hoveringSchemaId}
            onChangeHoveringSchemaId={onChangeHoveringSchemaId}
            height={size.height - RULER_HEIGHT * ZOOM}
            pageCursor={pageCursor}
            scale={scale}
            size={sizeExcSidebars}
            pageSizes={pageSizes}
            backgrounds={backgrounds}
            activeElements={activeElements}
            schemasList={schemasList}
            changeSchemas={changeSchemas}
            removeSchemas={removeSchemas}
            sidebarOpen={sidebarOpen}
            onEdit={onEdit}
          />
        </div>
        <DragOverlay dropAnimation={null}>
          {activeDragData && (
            <div
              style={{
                padding: '6px 10px',
                background: token.colorBgElevated,
                border: `1.5px solid ${token.colorPrimary}`,
                borderRadius: token.borderRadius,
                fontSize: 12,
                color: token.colorText,
                boxShadow: token.boxShadowSecondary,
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                opacity: 0.9,
                maxWidth: 200,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {(activeDragData as any).fieldMeta?.label ||
                (activeDragData as any).content ||
                (activeDragData as any).type ||
                'Schema'}
            </div>
          )}
        </DragOverlay>
      </DndContext>
      </GridContext.Provider>
    </Root>
  );
};

export default TemplateEditor;
