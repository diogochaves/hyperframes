import { CAPTURE_CANVAS_SELECTOR } from "./htmlInCanvas";

type UaWindow = { navigator: { userAgent: string } };

/** Major Chrome version from the user agent (HeadlessChrome included), or null when unknown. */
export function chromeMajor(win: UaWindow = window): number | null {
  const m = /Chrome\/(\d+)/.exec(win.navigator.userAgent);
  return m?.[1] ? Number(m[1]) : null;
}

export interface CaptureDefect {
  code: string;
  reason: string;
}

export interface DefectEnv {
  isAccelerated: (canvas: HTMLCanvasElement) => boolean;
  /** Result of `scanBackfaceDefect`, refreshed whenever the scene is rescanned. */
  backface: boolean;
}

// Every defect blocks on every Chrome version: render and preview browsers can differ.
interface Defect {
  code: string;
  reason: string;
  detect: (root: HTMLElement, env: DefectEnv) => boolean;
}

const hasHidden3dFace = (_root: HTMLElement, env: DefectEnv): boolean => env.backface;

// The whole document: a render's shader-transition canvas sits in <body>, preview's in the root.
const hasAcceleratedCanvas = (root: HTMLElement, env: DefectEnv): boolean =>
  Array.from(root.ownerDocument.querySelectorAll("canvas")).some(env.isAccelerated);

const IDENTITY_TRANSFORM =
  /^matrix\(\s*1,\s*0,\s*0,\s*1,\s*0,\s*0\s*\)$|^matrix3d\(\s*1,\s*0,\s*0,\s*0,\s*0,\s*1,\s*0,\s*0,\s*0,\s*0,\s*1,\s*0,\s*0,\s*0,\s*0,\s*1\s*\)$/;

const hasRootTransform = (root: HTMLElement): boolean => {
  const t = getComputedStyle(root).transform.trim();
  return t !== "none" && t !== "" && !IDENTITY_TRANSFORM.test(t);
};

const hasRootOpacity = (root: HTMLElement): boolean =>
  Number.parseFloat(getComputedStyle(root).opacity) < 1;

const DEFECTS: readonly Defect[] = [
  {
    code: "nested-capture-canvas",
    reason: "the composition already uses html-in-canvas",
    detect: (root) => root.querySelector(CAPTURE_CANVAS_SELECTOR) !== null,
  },
  {
    // Chrome <=156 captures the canvas frozen at its pre-wrap frame; 157 fixed it.
    code: "accelerated-canvas",
    reason: "the composition draws a WebGL/WebGPU canvas, which html-in-canvas captures frozen",
    detect: hasAcceleratedCanvas,
  },
  {
    code: "backface-visibility",
    reason: "backface-visibility: hidden inside a 3D transform is drawn mirrored by html-in-canvas",
    detect: hasHidden3dFace,
  },
  {
    code: "root-transform",
    reason: "html-in-canvas can ignore a transform on the composition root",
    detect: hasRootTransform,
  },
  {
    code: "root-opacity",
    reason: "html-in-canvas can ignore the composition root's own opacity",
    detect: hasRootOpacity,
  },
];

/** The first defect that makes html-in-canvas capture this root wrongly in any supported browser, or null. */
export function findCaptureDefect(root: HTMLElement, env: DefectEnv): CaptureDefect | null {
  const defect = DEFECTS.find((d) => d.detect(root, env));
  return defect ? { code: defect.code, reason: defect.reason } : null;
}

const FACE_3D_TRANSFORM = /perspective\(|rotate3d\(|rotate[XY]\(|matrix3d\(/;

function isHidden(cs: CSSStyleDeclaration): boolean {
  return (
    cs.getPropertyValue("backface-visibility") === "hidden" ||
    cs.getPropertyValue("-webkit-backface-visibility") === "hidden"
  );
}

function transformsIn3d(el: HTMLElement, cs: CSSStyleDeclaration): boolean {
  return FACE_3D_TRANSFORM.test(cs.transform) || FACE_3D_TRANSFORM.test(el.style.transform);
}

function in3dContext(el: HTMLElement, root: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const cs = getComputedStyle(node);
    if (cs.transformStyle === "preserve-3d" || transformsIn3d(node, cs)) return true;
    if (node !== el && cs.perspective !== "none" && cs.perspective !== "") return true;
    if (node === root) break;
  }
  return false;
}

function* styleRules(rules: CSSRuleList): Generator<CSSStyleRule> {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) yield rule;
    else if ("cssRules" in rule && rule.cssRules instanceof CSSRuleList)
      yield* styleRules(rule.cssRules);
  }
}

function sheetRules(sheet: CSSStyleSheet): CSSRuleList | null {
  try {
    return sheet.cssRules;
  } catch {
    return null;
  }
}

function matching(root: HTMLElement, selector: string): HTMLElement[] {
  try {
    const found = Array.from(root.querySelectorAll<HTMLElement>(selector));
    return root.matches(selector) ? [root, ...found] : found;
  } catch {
    return [];
  }
}

function hiddenSelectors(): string[] {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    const rules = sheetRules(sheet);
    if (!rules) continue;
    for (const rule of styleRules(rules)) if (isHidden(rule.style)) out.push(rule.selectorText);
  }
  return out;
}

/**
 * Whether a `backface-visibility: hidden` element is in a 3D context right now (flat uses are
 * harmless); call it at several timeline times to see a rotation that a later tween applies.
 */
function createBackfaceCheck(root: HTMLElement): () => boolean {
  const selectors = hiddenSelectors();
  return () => {
    const candidates = new Set<HTMLElement>(root.querySelectorAll('[style*="backface"]'));
    for (const selector of selectors) for (const el of matching(root, selector)) candidates.add(el);
    for (const el of candidates) {
      if (isHidden(getComputedStyle(el)) && in3dContext(el, root)) return true;
    }
    return false;
  };
}

export function scanBackfaceDefect(root: HTMLElement): boolean {
  return createBackfaceCheck(root)();
}

const FACE_EVERY = 10;

export interface DefectScan {
  sample: (i: number, steps: number, at: number) => void;
  result: () => CaptureDefect | null;
}

export function createDefectScan(
  root: HTMLElement,
  isAccelerated: DefectEnv["isAccelerated"],
): DefectScan {
  const faces = createBackfaceCheck(root);
  let found: CaptureDefect | null = null;
  return {
    sample: (i, steps, at) => {
      if (found) return;
      const checkFaces = i % FACE_EVERY === 0 || i === steps;
      const defect = findCaptureDefect(root, { isAccelerated, backface: checkFaces && faces() });
      if (defect)
        found = { ...defect, reason: `${defect.reason} (first seen at t=${at.toFixed(1)}s)` };
    },
    result: () => found,
  };
}
