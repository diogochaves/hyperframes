import { htmlInCanvasForm } from "./htmlInCanvas.js";

// Engine-set: the off switch (its sub-frame blur runs, or the preview could not blur); the render scale (dpr falls back to 1).
export const PAGE_MOTION_BLUR_OFF_GLOBAL = "__HF_PAGE_MOTION_BLUR_OFF__";
export const PAGE_DEVICE_SCALE_GLOBAL = "__HF_DEVICE_SCALE_FACTOR__";

export function supportsCaptureMotionBlur(win: Window = window): boolean {
  return htmlInCanvasForm(win) !== null;
}
