import React, { useEffect, forwardRef, Ref, useRef } from 'react';
import MoveableComponent, {
  OnDrag,
  OnDragStart,
  OnRotate,
  OnRotateStart,
  OnRotateEnd,
  OnClick,
  OnResize,
  OnResizeStart,
} from 'react-moveable';
import { uuid } from '../../../helper.js';
import { theme } from 'antd';

type Props = {
  target: HTMLElement[];
  container?: HTMLElement | null;
  bounds: { left: number; top: number; bottom: number; right: number };
  horizontalGuidelines: number[];
  verticalGuidelines: number[];
  keepRatio: boolean;
  rotatable: boolean;
  scale: number;
  onDragStart?: (e: OnDragStart) => void;
  onDrag: ({ target, left, top }: OnDrag) => void;
  onDragEnd: ({ target }: { target: HTMLElement | SVGElement }) => void;
  onDragGroupEnd: ({ targets }: { targets: (HTMLElement | SVGElement)[] }) => void;
  onRotateStart?: (e: OnRotateStart) => void;
  onRotate: ({ target, rotate }: OnRotate) => void;
  onRotateEnd: ({ target }: OnRotateEnd) => void;
  onRotateGroupEnd: ({ targets }: { targets: (HTMLElement | SVGElement)[] }) => void;
  onResizeStart?: (e: OnResizeStart) => void;
  onResize: ({ target, width, height, direction }: OnResize) => void;
  onResizeEnd: ({ target }: { target: HTMLElement | SVGElement }) => void;
  onResizeGroupEnd: ({ targets }: { targets: (HTMLElement | SVGElement)[] }) => void;
  onClick: (e: OnClick) => void;
};

const baseClassName = 'pdfme-moveable';

const Moveable = (props: Props, ref: Ref<MoveableComponent>) => {
  const { token } = theme.useToken();
  const instanceId = useRef(uuid());
  const uniqueClassName = `${baseClassName}-${instanceId.current}`;

  useEffect(() => {
    const containerElement = document.querySelector(`.${uniqueClassName}`);
    const moveableLines = document.querySelectorAll(`.${uniqueClassName} .moveable-line`);
    if (containerElement instanceof HTMLElement) {
      containerElement.style.setProperty('--moveable-color', token.colorPrimary);
      moveableLines.forEach((e) => {
        if (e instanceof HTMLElement) {
          e.style.setProperty('--moveable-color', token.colorPrimary);
        }
      });
    }
  }, [props.target, token.colorPrimary, uniqueClassName]);

  return (
    <MoveableComponent
      className={uniqueClassName}
      snappable
      draggable
      rotatable={props.rotatable}
      resizable
      edge={true}
      origin={false}
      zoom={1 / props.scale}
      container={props.container || undefined}
      throttleDrag={1}
      throttleRotate={1}
      throttleResize={16}
      ref={ref}
      target={props.target}
      bounds={props.bounds}
      horizontalGuidelines={props.horizontalGuidelines}
      verticalGuidelines={props.verticalGuidelines}
      keepRatio={props.keepRatio}
      onRotate={props.onRotate}
      onRotateEnd={props.onRotateEnd}
      onRotateGroup={({ events }: { events: OnRotate[] }) => {
        events.forEach(props.onRotate);
      }}
      onRotateGroupEnd={props.onRotateGroupEnd}
      onDragStart={props.onDragStart}
      onDragGroupStart={props.onDragStart ? ({ events }: { events: OnDragStart[] }) => {
        if (events.length > 0) props.onDragStart!(events[0]);
      } : undefined}
      onDrag={props.onDrag}
      onDragGroup={({ events }: { events: OnDrag[] }) => {
        events.forEach(props.onDrag);
      }}
      onDragEnd={props.onDragEnd}
      onDragGroupEnd={props.onDragGroupEnd}
      onResizeStart={props.onResizeStart}
      onResizeGroupStart={props.onResizeStart ? ({ events }: { events: OnResizeStart[] }) => {
        if (events.length > 0) props.onResizeStart!(events[0]);
      } : undefined}
      onResize={props.onResize}
      onResizeGroup={({ events }: { events: OnResize[] }) => {
        events.forEach(props.onResize);
      }}
      onResizeEnd={props.onResizeEnd}
      onResizeGroupEnd={props.onResizeGroupEnd}
      onClick={props.onClick}
    />
  );
};

export default forwardRef<MoveableComponent, Props>(Moveable);
