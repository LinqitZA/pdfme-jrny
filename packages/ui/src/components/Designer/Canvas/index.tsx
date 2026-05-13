import React, {
  Ref,
  useMemo,
  useContext,
  MutableRefObject,
  useRef,
  useState,
  useEffect,
  forwardRef,
  useCallback,
  useImperativeHandle,
} from 'react';
import { theme, Button } from 'antd';
import MoveableComponent, { OnDrag, OnRotate, OnResize } from 'react-moveable';
import {
  ZOOM,
  SchemaForUI,
  Size,
  ChangeSchemas,
  BasePdf,
  isBlankPdf,
  replacePlaceholders,
} from '@pdfme/common';
import { PluginsRegistry } from '../../../contexts.js';
import { X } from 'lucide-react';
import { RULER_HEIGHT, DESIGNER_CLASSNAME } from '../../../constants.js';
import { usePrevious } from '../../../hooks.js';
import { round, flatten, uuid } from '../../../helper.js';
import Paper from '../../Paper.js';
import Renderer from '../../Renderer.js';
import Selecto from './Selecto.js';
import Moveable from './Moveable.js';
import Guides from './Guides.js';
import Mask from './Mask.js';
import Padding from './Padding.js';
import StaticSchema from '../../StaticSchema.js';

const mm2px = (mm: number) => mm * 3.7795275591;

const DELETE_BTN_ID = uuid();
const fmt4Num = (prop: string) => Number(prop.replace('px', ''));
const fmt = (prop: string) => round(fmt4Num(prop) / ZOOM, 2);
const isTopLeftResize = (d: string) => d === '-1,-1' || d === '-1,0' || d === '0,-1';
const normalizeRotate = (angle: number) => ((angle % 360) + 360) % 360;

const DeleteButton = ({ activeElements: aes }: { activeElements: HTMLElement[] }) => {
  const { token } = theme.useToken();

  const size = 26;
  const top = Math.min(...aes.map(({ style }) => fmt4Num(style.top)));
  const left = Math.max(...aes.map(({ style }) => fmt4Num(style.left) + fmt4Num(style.width))) + 10;

  return (
    <Button
      id={DELETE_BTN_ID}
      className={DESIGNER_CLASSNAME + 'delete-button'}
      style={{
        position: 'absolute',
        zIndex: 1,
        top,
        left,
        width: size,
        height: size,
        padding: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: token.borderRadius,
        color: token.colorWhite,
        background: token.colorPrimary,
      }}
    >
      <X style={{ pointerEvents: 'none' }} />
    </Button>
  );
};

interface GuidesInterface {
  getGuides(): number[];
  scroll(pos: number): void;
  scrollGuides(pos: number): void;
  loadGuides(guides: number[]): void;
  resize(): void;
}

interface Props {
  basePdf: BasePdf;
  height: number;
  hoveringSchemaId: string | null;
  onChangeHoveringSchemaId: (id: string | null) => void;
  pageCursor: number;
  schemasList: SchemaForUI[][];
  scale: number;
  backgrounds: string[];
  pageSizes: Size[];
  size: Size;
  activeElements: HTMLElement[];
  onEdit: (targets: HTMLElement[]) => void;
  changeSchemas: ChangeSchemas;
  removeSchemas: (ids: string[]) => void;
  paperRefs: MutableRefObject<HTMLDivElement[]>;
  sidebarOpen: boolean;
}

const Canvas = (props: Props, ref: Ref<HTMLDivElement>) => {
  const {
    basePdf,
    pageCursor,
    scale,
    backgrounds,
    pageSizes,
    size,
    activeElements,
    schemasList,
    hoveringSchemaId,
    onEdit,
    changeSchemas,
    removeSchemas,
    onChangeHoveringSchemaId,
    paperRefs,
    sidebarOpen,
  } = props;
  const { token } = theme.useToken();
  const pluginsRegistry = useContext(PluginsRegistry);
  const verticalGuides = useRef<GuidesInterface[]>([]);
  const horizontalGuides = useRef<GuidesInterface[]>([]);
  const moveable = useRef<MoveableComponent>(null);
  const paperScaleRef = useRef<HTMLDivElement>(null);
  // Local ref for the canvas scroll container — needed to pass as rootContainer
  // to Moveable (must be outside the CSS transform:scale() wrapper in Paper)
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  // Forward the local ref to the parent via the forwarded ref
  useImperativeHandle(ref, () => canvasContainerRef.current as HTMLDivElement);

  const [isPressShiftKey, setIsPressShiftKey] = useState(false);
  const [editing, setEditing] = useState(false);

  // ---- Crosshair cursor tracking (throttled) ----
  const [crosshairPos, setCrosshairPos] = useState<{
    x: number;
    y: number;
    scrollW: number;
    scrollH: number;
  } | null>(null);

  // Suppress crosshair updates while Moveable is actively dragging or resizing
  const isDraggingRef = useRef(false);
  // Track pending rAF to avoid queuing multiple frames
  const rafIdRef = useRef<number | null>(null);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Skip crosshair updates entirely during drag/resize operations
    if (isDraggingRef.current) return;

    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    // Position relative to the scrollable canvas content
    const x = e.clientX - rect.left + container.scrollLeft;
    const y = e.clientY - rect.top + container.scrollTop;
    const scrollW = container.scrollWidth;
    const scrollH = container.scrollHeight;

    // Throttle to one update per animation frame
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      setCrosshairPos({ x, y, scrollW, scrollH });
    });
  }, []);

  const handleCanvasMouseLeave = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    setCrosshairPos(null);
  }, []);

  // Cleanup pending rAF on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  const prevSchemas = usePrevious(schemasList[pageCursor]);

  const onKeydown = (e: KeyboardEvent) => {
    if (e.shiftKey) setIsPressShiftKey(true);
  };
  const onKeyup = (e: KeyboardEvent) => {
    if (e.key === 'Shift' || !e.shiftKey) setIsPressShiftKey(false);
    if (e.key === 'Escape' || e.key === 'Esc') setEditing(false);
  };

  const initEvents = useCallback(() => {
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('keyup', onKeyup);
  }, []);

  const destroyEvents = useCallback(() => {
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('keyup', onKeyup);
  }, []);

  useEffect(() => {
    initEvents();

    return destroyEvents;
  }, [initEvents, destroyEvents]);

  useEffect(() => {
    moveable.current?.updateRect();
    if (!prevSchemas) {
      return;
    }

    const prevSchemaKeys = JSON.stringify(prevSchemas[pageCursor] || {});
    const schemaKeys = JSON.stringify(schemasList[pageCursor] || {});

    if (prevSchemaKeys === schemaKeys) {
      moveable.current?.updateRect();
    }
  }, [pageCursor, schemasList, prevSchemas]);

  // Disable crosshair when Moveable starts a drag or resize
  const onMoveableInteractionStart = useCallback(() => {
    isDraggingRef.current = true;
    // Cancel any pending crosshair update and hide the crosshair
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    setCrosshairPos(null);
  }, []);

  const onDrag = ({ target, top, left }: OnDrag) => {
    const { width: _width, height: _height } = target.style;
    const targetWidth = fmt(_width);
    const targetHeight = fmt(_height);
    const actualTop = top / ZOOM;
    const actualLeft = left / ZOOM;
    const { width: pageWidth, height: pageHeight } = pageSizes[pageCursor];
    let topPadding = 0;
    let rightPadding = 0;
    let bottomPadding = 0;
    let leftPadding = 0;

    if (isBlankPdf(basePdf)) {
      const [t, r, b, l] = basePdf.padding;
      topPadding = t * ZOOM;
      rightPadding = r;
      bottomPadding = b;
      leftPadding = l * ZOOM;
    }

    if (actualTop + targetHeight > pageHeight - bottomPadding) {
      target.style.top = `${(pageHeight - targetHeight - bottomPadding) * ZOOM}px`;
    } else {
      target.style.top = `${top < topPadding ? topPadding : top}px`;
    }

    if (actualLeft + targetWidth > pageWidth - rightPadding) {
      target.style.left = `${(pageWidth - targetWidth - rightPadding) * ZOOM}px`;
    } else {
      target.style.left = `${left < leftPadding ? leftPadding : left}px`;
    }
  };

  const onDragEnd = ({ target }: { target: HTMLElement | SVGElement }) => {
    isDraggingRef.current = false;
    const { top, left } = target.style;
    changeSchemas([
      { key: 'position.y', value: fmt(top), schemaId: target.id },
      { key: 'position.x', value: fmt(left), schemaId: target.id },
    ]);
  };

  const onDragEnds = ({ targets }: { targets: (HTMLElement | SVGElement)[] }) => {
    isDraggingRef.current = false;
    const arg = targets.map(({ style: { top, left }, id }) => [
      { key: 'position.y', value: fmt(top), schemaId: id },
      { key: 'position.x', value: fmt(left), schemaId: id },
    ]);
    changeSchemas(flatten(arg));
  };

  const onRotate = ({ target, rotate }: OnRotate) => {
    target.style.transform = `rotate(${rotate}deg)`;
  };

  const onRotateEnd = ({ target }: { target: HTMLElement | SVGElement }) => {
    isDraggingRef.current = false;
    const { transform } = target.style;
    const rotate = Number(transform.replace('rotate(', '').replace('deg)', ''));
    const normalizedRotate = normalizeRotate(rotate);
    changeSchemas([{ key: 'rotate', value: normalizedRotate, schemaId: target.id }]);
  };

  const onRotateEnds = ({ targets }: { targets: (HTMLElement | SVGElement)[] }) => {
    isDraggingRef.current = false;
    const arg = targets.map(({ style: { transform }, id }) => {
      const rotate = Number(transform.replace('rotate(', '').replace('deg)', ''));
      const normalizedRotate = normalizeRotate(rotate);
      return [{ key: 'rotate', value: normalizedRotate, schemaId: id }];
    });
    changeSchemas(flatten(arg));
  };

  const onResizeEnd = ({ target }: { target: HTMLElement | SVGElement }) => {
    isDraggingRef.current = false;
    const { id, style } = target;
    const { width, height, top, left } = style;
    changeSchemas([
      { key: 'position.x', value: fmt(left), schemaId: id },
      { key: 'position.y', value: fmt(top), schemaId: id },
      { key: 'width', value: fmt(width), schemaId: id },
      { key: 'height', value: fmt(height), schemaId: id },
    ]);
    // Note: Do NOT directly mutate targetSchema here. The changeSchemas() call
    // above handles state updates through React's state management. Direct mutation
    // creates race conditions where Moveable's stale DOM references conflict with
    // React's re-render cycle, causing resize interactions to freeze.
  };

  const onResizeEnds = ({ targets }: { targets: (HTMLElement | SVGElement)[] }) => {
    isDraggingRef.current = false;
    const arg = targets.map(({ style: { width, height, top, left }, id }) => [
      { key: 'width', value: fmt(width), schemaId: id },
      { key: 'height', value: fmt(height), schemaId: id },
      { key: 'position.y', value: fmt(top), schemaId: id },
      { key: 'position.x', value: fmt(left), schemaId: id },
    ]);
    changeSchemas(flatten(arg));
  };

  const onResize = ({ target, width, height, direction }: OnResize) => {
    if (!target) return;
    let topPadding = 0;
    let rightPadding = 0;
    let bottomPadding = 0;
    let leftPadding = 0;

    if (isBlankPdf(basePdf)) {
      const [t, r, b, l] = basePdf.padding;
      topPadding = t * ZOOM;
      rightPadding = mm2px(r);
      bottomPadding = mm2px(b);
      leftPadding = l * ZOOM;
    }

    const pageWidth = mm2px(pageSizes[pageCursor].width);
    const pageHeight = mm2px(pageSizes[pageCursor].height);

    const obj: { top?: string; left?: string; width: string; height: string } = {
      width: `${width}px`,
      height: `${height}px`,
    };

    const s = target.style;
    let newLeft = fmt4Num(s.left) + (fmt4Num(s.width) - width);
    let newTop = fmt4Num(s.top) + (fmt4Num(s.height) - height);
    if (newLeft < leftPadding) {
      newLeft = leftPadding;
    }
    if (newTop < topPadding) {
      newTop = topPadding;
    }
    if (newLeft + width > pageWidth - rightPadding) {
      obj.width = `${pageWidth - rightPadding - newLeft}px`;
    }
    if (newTop + height > pageHeight - bottomPadding) {
      obj.height = `${pageHeight - bottomPadding - newTop}px`;
    }

    const d = direction.toString();
    if (isTopLeftResize(d)) {
      obj.top = `${newTop}px`;
      obj.left = `${newLeft}px`;
    } else if (d === '1,-1') {
      obj.top = `${newTop}px`;
    } else if (d === '-1,1') {
      obj.left = `${newLeft}px`;
    }
    Object.assign(s, obj);
  };

  const getGuideLines = (guides: GuidesInterface[], index: number) =>
    guides[index] && guides[index].getGuides().map((g) => g * ZOOM);

  const onClickMoveable = () => {
    // Just set editing to true without trying to access event properties
    setEditing(true);
  };

  const rotatable = useMemo(() => {
    const selectedSchemas = (schemasList[pageCursor] || []).filter((s) =>
      activeElements.map((ae) => ae.id).includes(s.id),
    );
    const schemaTypes = selectedSchemas.map((s) => s.type);
    const uniqueSchemaTypes = [...new Set(schemaTypes)];

    // Create a type-safe array of default schemas
    const defaultSchemas: Record<string, unknown>[] = [];

    pluginsRegistry.entries().forEach(([, plugin]) => {
      if (plugin.propPanel.defaultSchema) {
        defaultSchemas.push(plugin.propPanel.defaultSchema as Record<string, unknown>);
      }
    });

    // Check if all schema types have rotate property
    return uniqueSchemaTypes.every((type) => {
      const matchingSchema = defaultSchemas.find((ds) => ds && 'type' in ds && ds.type === type);
      return matchingSchema && 'rotate' in matchingSchema;
    });
  }, [activeElements, pageCursor, schemasList, pluginsRegistry]);

  return (
    <div
      className={DESIGNER_CLASSNAME + 'canvas'}
      style={{
        position: 'relative',
        overflow: 'auto',
        ...size,
      }}
      ref={canvasContainerRef}
      onMouseMove={handleCanvasMouseMove}
      onMouseLeave={handleCanvasMouseLeave}
    >
      {/* Crosshair tracking lines */}
      {crosshairPos && (
        <>
          {/* Vertical line */}
          <div
            style={{
              position: 'absolute',
              left: crosshairPos.x,
              top: 0,
              width: 0,
              height: crosshairPos.scrollH,
              borderLeft: '1px dashed rgba(59, 130, 246, 0.4)',
              pointerEvents: 'none',
              zIndex: 9999,
            }}
          />
          {/* Horizontal line */}
          <div
            style={{
              position: 'absolute',
              top: crosshairPos.y,
              left: 0,
              height: 0,
              width: crosshairPos.scrollW,
              borderTop: '1px dashed rgba(59, 130, 246, 0.4)',
              pointerEvents: 'none',
              zIndex: 9999,
            }}
          />
        </>
      )}
      <Selecto
        container={paperRefs.current[pageCursor]}
        dragContainer={canvasContainerRef.current}
        continueSelect={isPressShiftKey}
        onDragStart={(e) => {
          // Use type assertion to safely access inputEvent properties
          const inputEvent = e.inputEvent as MouseEvent | TouchEvent;
          const target = inputEvent.target as Element | null;
          const isMoveableElement = moveable.current?.isMoveableElement(target as Element);

          if ((inputEvent.type === 'touchstart' && e.isTrusted) || isMoveableElement) {
            e.stop();
          }

          if (paperRefs.current[pageCursor] === target) {
            onEdit([]);
          }

          // Check if the target is an HTMLElement and has an id property
          const targetElement = target as HTMLElement | null;
          if (targetElement && targetElement.id === DELETE_BTN_ID) {
            removeSchemas(activeElements.map((ae) => ae.id));
          }
        }}
        onSelect={(e) => {
          // Use type assertions to safely access properties
          const inputEvent = e.inputEvent as MouseEvent | TouchEvent;
          const added = e.added as HTMLElement[];
          const removed = e.removed as HTMLElement[];
          const selected = e.selected as HTMLElement[];

          const isClick = inputEvent.type === 'mousedown';
          let newActiveElements: HTMLElement[] = isClick ? selected : [];

          if (!isClick && added.length > 0) {
            newActiveElements = activeElements.concat(added);
          }
          if (!isClick && removed.length > 0) {
            newActiveElements = activeElements.filter((ae) => !removed.includes(ae));
          }
          onEdit(newActiveElements);

          if (newActiveElements != activeElements) {
            setEditing(false);
          }

          // For MacOS CMD+SHIFT+3/4 screenshots where the keydown event is never received, check mouse too
          const mouseEvent = inputEvent as MouseEvent;
          if (mouseEvent && typeof mouseEvent.shiftKey === 'boolean' && !mouseEvent.shiftKey) {
            setIsPressShiftKey(false);
          }
        }}
      />
      <Paper
        ref={paperScaleRef}
        paperRefs={paperRefs}
        scale={scale}
        size={size}
        schemasList={schemasList}
        pageSizes={pageSizes}
        backgrounds={backgrounds}
        hasRulers={true}
        renderPaper={({ index, paperSize, rulerSpan }) => (
          <>
            {!editing && activeElements.length > 0 && pageCursor === index && (
              <DeleteButton activeElements={activeElements} />
            )}
            <Padding basePdf={basePdf} />
            <StaticSchema
              template={{ schemas: schemasList, basePdf }}
              input={Object.fromEntries(
                schemasList.flat().map(({ name, content = '' }) => [name, content]),
              )}
              scale={scale}
              totalPages={schemasList.length}
              currentPage={index + 1}
            />
            <Guides
              paperSize={paperSize}
              rulerSpan={rulerSpan}
              horizontalRef={(e) => {
                if (e) horizontalGuides.current[index] = e;
              }}
              verticalRef={(e) => {
                if (e) verticalGuides.current[index] = e;
              }}
            />
            {pageCursor !== index ? (
              <Mask
                width={paperSize.width + RULER_HEIGHT}
                height={paperSize.height + RULER_HEIGHT}
              />
            ) : (
              !editing && (
                <Moveable
                  ref={moveable}
                  target={activeElements}
                  container={paperRefs.current[index]}
                  rootContainer={canvasContainerRef.current}
                  bounds={{ left: 0, top: 0, bottom: paperSize.height, right: paperSize.width }}
                  horizontalGuidelines={getGuideLines(horizontalGuides.current, index)}
                  verticalGuidelines={getGuideLines(verticalGuides.current, index)}
                  keepRatio={isPressShiftKey}
                  rotatable={rotatable}
                  scale={scale}
                  onDragStart={onMoveableInteractionStart}
                  onDrag={onDrag}
                  onDragEnd={onDragEnd}
                  onDragGroupEnd={onDragEnds}
                  onRotateStart={onMoveableInteractionStart}
                  onRotate={onRotate}
                  onRotateEnd={onRotateEnd}
                  onRotateGroupEnd={onRotateEnds}
                  onResizeStart={onMoveableInteractionStart}
                  onResize={onResize}
                  onResizeEnd={onResizeEnd}
                  onResizeGroupEnd={onResizeEnds}
                  onClick={onClickMoveable}
                />
              )
            )}
          </>
        )}
        renderSchema={({ schema, index }) => {
          const isSelected = activeElements.some((ae) => ae.id === schema.id);
          const mode =
            editing && isSelected
              ? 'designer'
              : 'viewer';

          const content = schema.content || '';
          let value = content;

          if (mode !== 'designer' && schema.readOnly) {
            const variables = {
              ...schemasList.flat().reduce(
                (acc, currSchema) => {
                  acc[currSchema.name] = currSchema.content || '';
                  return acc;
                },
                {} as Record<string, string>,
              ),
              totalPages: schemasList.length,
              currentPage: index + 1,
            };

            value = replacePlaceholders({ content, variables, schemas: schemasList });
          }

          // When an element is selected, Moveable renders its own control box
          // around it. Suppress the element's CSS outline to prevent a double
          // outline / ghost border effect.
          const outline = isSelected
            ? 'none'
            : `1px ${hoveringSchemaId === schema.id ? 'solid' : 'dashed'} ${
                schema.readOnly && hoveringSchemaId !== schema.id
                  ? 'transparent'
                  : token.colorPrimary
              }`;

          return (
            <Renderer
              key={schema.id}
              schema={schema}
              basePdf={basePdf}
              value={value}
              onChangeHoveringSchemaId={onChangeHoveringSchemaId}
              mode={mode}
              onChange={
                (schemasList[pageCursor] || []).some((s) => s.id === schema.id)
                  ? (arg) => {
                      // Use type assertion to safely handle the argument
                      type ChangeArg = { key: string; value: unknown };
                      const args = Array.isArray(arg) ? (arg as ChangeArg[]) : [arg as ChangeArg];
                      changeSchemas(
                        args.map(({ key, value }) => ({ key, value, schemaId: schema.id })),
                      );
                    }
                  : undefined
              }
              stopEditing={() => setEditing(false)}
              outline={outline}
              scale={scale}
            />
          );
        }}
      />
    </div>
  );
};
export default forwardRef<HTMLDivElement, Props>(Canvas);
