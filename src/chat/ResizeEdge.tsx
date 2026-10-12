import { useRef, type KeyboardEvent, type PointerEvent } from "react";

/** The left edge of a column at the chat's right: drag it (or arrow keys) to resize, double-click
 *  for the default width. `resize` clamps and applies a width and returns it; `save` keeps it. */
export function ResizeEdge({ label, width, min, max, fallback, resize, save }: {
  label: string;
  width: number;
  min: number;
  max: number;
  fallback: number;
  resize: (px: number) => number;
  save: (px: number) => void;
}) {
  // Where a drag began: the column sits at the right, so moving left widens it.
  const drag = useRef<{ x: number; width: number } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, width };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) resize(drag.current.width + drag.current.x - e.clientX);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    save(resize(drag.current.width + drag.current.x - e.clientX));
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowLeft" ? 16 : e.key === "ArrowRight" ? -16 : 0;
    if (step === 0) return;
    e.preventDefault();
    save(resize(width + step));
  };
  return (
    <div
      className="chat-outline-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => save(resize(fallback))}
      onKeyDown={onKeyDown}
    />
  );
}
