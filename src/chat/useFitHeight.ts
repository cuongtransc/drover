import { useEffect, useLayoutEffect, type RefObject } from "react";

/**
 * Grows the textarea with its `text` up to its CSS max-height, then it scrolls; `rows` sets its
 * floor. A narrower box wraps the same text onto more lines, so a width change fits it again.
 */
export function useFitHeight(box: RefObject<HTMLTextAreaElement | null>, text: string) {
  const fit = () => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(fit, [text]);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
}
