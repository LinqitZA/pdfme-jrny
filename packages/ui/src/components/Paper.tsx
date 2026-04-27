import React, { MutableRefObject, ReactNode, useContext, forwardRef, Ref } from 'react';
import { ZOOM, SchemaForUI, Size, getFallbackFontName } from '@pdfme/common';
import { FontContext } from '../contexts.js';
import { useGridSize } from '../contexts/GridContext.js';
import { RULER_HEIGHT, PAGE_GAP } from '../constants.js';

interface PaperProps {
  paperRefs: MutableRefObject<HTMLDivElement[]>;
  scale: number;
  size: Size;
  schemasList: SchemaForUI[][];
  pageSizes: Size[];
  backgrounds: string[];
  renderPaper: (arg: { index: number; paperSize: Size; rulerSpan?: { hWidth: number; hLeft: number; vHeight: number } }) => ReactNode;
  renderSchema: (arg: { index: number; schema: SchemaForUI }) => ReactNode;
  hasRulers?: boolean;
}

const PaperInner = (props: PaperProps, ref: Ref<HTMLDivElement>) => {
  const {
    paperRefs,
    scale,
    size,
    schemasList,
    pageSizes,
    backgrounds,
    renderPaper,
    renderSchema,
    hasRulers,
  } = props;
  const font = useContext(FontContext);
  const { gridSizeMm } = useGridSize();
  const rulerHeight = hasRulers ? RULER_HEIGHT : 0;

  /** Grid spacing in px — computed from context gridSizeMm. 0 means no grid. */
  const gridSpacingPx = gridSizeMm > 0 ? Math.round(gridSizeMm * ZOOM) : 0;
  const showGrid = hasRulers && gridSpacingPx > 0;

  if (pageSizes.length !== backgrounds.length || pageSizes.length !== schemasList.length) {
    return null;
  }

  return (
    <div
      ref={ref}
      style={{
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
        // NOTE: These values do not impact the UI unless they exceed the Paper sizes.
        // We set them to the scale value to ensure the container is redrawn when you zoom in/out.
        height: scale,
        width: scale,
      }}
    >
      {backgrounds.map((background, paperIndex) => {
        const pageSize = pageSizes[paperIndex];
        const paperSize = { width: pageSize.width * ZOOM, height: pageSize.height * ZOOM };

        // We want to center the content within the available viewport, but transform: scale()
        // must be done from the top-left or CSS crops off left-hand content as you zoom in.
        // However, we want to display the content centrally, so we apply a left indent for
        // when the content does not exceed its container
        const leftCenteringIndent =
          paperSize.width * scale + rulerHeight < size.width
            ? `${(size.width / scale - paperSize.width) / 2}px`
            : `${rulerHeight}px`;

        // Rulers are drawn above/before the top of each page, so each Paper div must have
        // a top offset considering them.
        let pageTop = paperIndex > 0 ? (rulerHeight + PAGE_GAP) * (paperIndex + 1) : rulerHeight;

        if (!hasRulers) {
          // If no rulers (i.e. Preview/Form) then we'll add an initial gap at the top of the first page
          pageTop += PAGE_GAP * 2;
        }

        return (
          <div
            key={String(paperIndex) + JSON.stringify(paperSize)}
            ref={(e) => {
              if (e) {
                paperRefs.current[paperIndex] = e;
              }
            }}
            onMouseDown={(e) => {
              if (
                e.currentTarget === e.target &&
                document &&
                document.hasFocus() &&
                document.activeElement instanceof HTMLElement
              ) {
                document.activeElement.blur();
              }
            }}
            style={{
              fontFamily: `'${getFallbackFontName(font)}'`,
              top: `${pageTop}px`,
              left: leftCenteringIndent,
              position: 'relative',
              backgroundImage: showGrid
                ? `linear-gradient(to right, rgba(148,163,184,0.3) 0.5px, transparent 0.5px), linear-gradient(to bottom, rgba(148,163,184,0.3) 0.5px, transparent 0.5px), url(${background})`
                : `url(${background})`,
              backgroundSize: showGrid
                ? `${gridSpacingPx}px ${gridSpacingPx}px, ${gridSpacingPx}px ${gridSpacingPx}px, ${paperSize.width}px ${paperSize.height}px`
                : `${paperSize.width}px ${paperSize.height}px`,
              boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04)',
              ...paperSize,
            }}
          >
            {renderPaper({
              paperSize,
              index: paperIndex,
              rulerSpan: hasRulers ? (() => {
                // Calculate ruler dimensions in the paper's coordinate space.
                // The paper is inside a transform:scale(scale) div, so we convert
                // the canvas viewport back to paper coords: canvasWidth = size.width / scale.
                const canvasWidthInPaper = size.width / scale;
                const canvasHeightInPaper = size.height / scale;
                // leftCenteringIndent is the paper's left offset from the Paper scale div edge
                const indent = paperSize.width * scale + rulerHeight < size.width
                  ? (size.width / scale - paperSize.width) / 2
                  : rulerHeight;
                return {
                  hWidth: Math.max(canvasWidthInPaper, paperSize.width),
                  hLeft: -indent,
                  vHeight: Math.max(canvasHeightInPaper, paperSize.height),
                };
              })() : undefined,
            })}
            {schemasList[paperIndex].map((schema, schemaIndex) => {
              return (
                <div key={schema.id}>
                  {renderSchema({
                    schema,
                    index:
                      paperIndex === 0
                        ? schemaIndex
                        : schemaIndex + schemasList[paperIndex - 1].length,
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

const Paper = forwardRef<HTMLDivElement, PaperProps>(PaperInner);

export default Paper;
