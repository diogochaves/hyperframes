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
  win?: UaWindow;
}

interface Defect {
  code: string;
  reason: string;
  /** Chrome majors the defect applies to; null bounds are open. */
  from: number | null;
  until: number | null;
  detect: (root: HTMLElement, env: DefectEnv) => boolean;
}

const hasHidden3dFace = (_root: HTMLElement, env: DefectEnv): boolean => env.backface;

const hasAcceleratedCanvas = (root: HTMLElement, env: DefectEnv): boolean =>
  Array.from(root.querySelectorAll("canvas")).some(env.isAccelerated);

const hasRootTransform = (root: HTMLElement): boolean => {
  const t = getComputedStyle(root).transform;
  return t !== "none" && t !== "";
};

const hasRootOpacity = (root: HTMLElement): boolean =>
  Number.parseFloat(getComputedStyle(root).opacity) < 1;

// Chrome <=156 captures a WebGL canvas frozen at its pre-wrap frame; 157 fixed it.
const DEFECTS: readonly Defect[] = [
  {
    code: "nested-capture-canvas",
    reason: "the composition already uses html-in-canvas",
    from: null,
    until: null,
    detect: (root) => root.querySelector(CAPTURE_CANVAS_SELECTOR) !== null,
  },
  {
    code: "accelerated-canvas",
    reason: "the composition draws a WebGL/WebGPU canvas, which html-in-canvas captures frozen",
    from: null,
    until: 157,
    detect: hasAcceleratedCanvas,
  },
  {
    code: "backface-visibility",
    reason: "backface-visibility: hidden inside a 3D transform is drawn mirrored by html-in-canvas",
    from: null,
    until: null,
    detect: hasHidden3dFace,
  },
  {
    code: "root-transform",
    reason: "html-in-canvas ignores a transform on the composition root in this Chrome version",
    from: null,
    until: 157,
    detect: hasRootTransform,
  },
  {
    code: "root-opacity",
    reason: "html-in-canvas ignores the composition root's own opacity in this Chrome version",
    from: 155,
    until: null,
    detect: hasRootOpacity,
  },
];

function applies(defect: Defect, major: number | null): boolean {
  if (major === null) return true;
  return (
    (defect.from === null || major >= defect.from) &&
    (defect.until === null || major < defect.until)
  );
}

/** The first defect that makes html-in-canvas capture this root wrongly in this browser, or null. */
export function findCaptureDefect(root: HTMLElement, env: DefectEnv): CaptureDefect | null {
  const major = chromeMajor(env.win);
  for (const defect of DEFECTS) {
    if (applies(defect, major) && defect.detect(root, env)) {
      return { code: defect.code, reason: defect.reason };
    }
  }
  return null;
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

function backfaceCandidates(root: HTMLElement): Set<HTMLElement> {
  const found = new Set<HTMLElement>(root.querySelectorAll<HTMLElement>('[style*="backface"]'));
  for (const sheet of Array.from(document.styleSheets)) {
    const rules = sheetRules(sheet);
    if (!rules) continue;
    for (const rule of styleRules(rules)) {
      if (!isHidden(rule.style)) continue;
      for (const el of matching(root, rule.selectorText)) found.add(el);
    }
  }
  return found;
}

/**
 * A `backface-visibility: hidden` element in a 3D context (preserve-3d, perspective or a 3D
 * transform), which html-in-canvas draws anyway. Flat uses are a harmless performance hack.
 * Residual: a rotation that only appears later, via a tween on an element with no 3D context at
 * scan time, is not seen.
 */
export function scanBackfaceDefect(root: HTMLElement): boolean {
  for (const el of backfaceCandidates(root)) {
    if (isHidden(getComputedStyle(el)) && in3dContext(el, root)) return true;
  }
  return false;
}
