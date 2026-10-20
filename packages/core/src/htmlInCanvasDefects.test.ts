import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chromeMajor,
  createDefectScan,
  findCaptureDefect,
  scanBackfaceDefect,
  type DefectEnv,
} from "./htmlInCanvasDefects";

const ua = (major: number | null, headless = false) => ({
  navigator: {
    userAgent:
      major === null
        ? "Mozilla/5.0 HappyDOM"
        : `Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) ${headless ? "HeadlessChrome" : "Chrome"}/${major}.0.0.0 Safari/537.36`,
  },
});

function mount(html: string, rootStyle = ""): HTMLElement {
  document.body.innerHTML = `<div id="root" style="${rootStyle}">${html}</div>`;
  const root = document.getElementById("root");
  if (!root) throw new Error("no root");
  return root;
}

const env = (over: Partial<DefectEnv> = {}): DefectEnv => ({
  isAccelerated: () => false,
  backface: false,
  ...over,
});

const code = (root: HTMLElement, e: DefectEnv) => findCaptureDefect(root, e)?.code ?? null;

/** Every Chrome the render and preview browsers can be, and an unknown one. */
const VERSIONS = [152, 155, 156, 157, 158, null] as const;

/** The defect found with the page's user agent set to `major`. */
function codeOn(major: number | null, root: HTMLElement, e: DefectEnv): string | null {
  const spy = vi
    .spyOn(window.navigator, "userAgent", "get")
    .mockReturnValue(ua(major).navigator.userAgent);
  try {
    return code(root, e);
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

describe("chromeMajor", () => {
  it("reads Chrome and HeadlessChrome, and is null for anything else", () => {
    expect(chromeMajor(ua(152, true))).toBe(152);
    expect(chromeMajor(ua(157))).toBe(157);
    expect(chromeMajor(ua(null))).toBeNull();
  });
});

describe("nested-capture-canvas", () => {
  it("is found on every version, in either API form", () => {
    for (const attr of ["layoutsubtree", 'content="drawable"']) {
      const root = mount(`<canvas ${attr}></canvas>`);
      for (const major of VERSIONS)
        expect(codeOn(major, root, env())).toBe("nested-capture-canvas");
    }
  });

  it("is not reported for a plain canvas", () => {
    expect(code(mount("<canvas></canvas>"), env())).toBeNull();
  });
});

describe("accelerated-canvas", () => {
  const gl = (root: HTMLElement) => env({ isAccelerated: (c) => root.contains(c) });

  it("applies on every version, 157 and 158 included", () => {
    const root = mount("<canvas></canvas>");
    for (const major of VERSIONS) {
      expect(codeOn(major, root, gl(root))).toBe("accelerated-canvas");
    }
  });

  it("finds a WebGL canvas outside the root, where a render's shader compositor puts it", () => {
    const root = mount("");
    const outside = document.createElement("canvas");
    document.body.append(outside);
    for (const major of VERSIONS) {
      expect(codeOn(major, root, env({ isAccelerated: (c) => c === outside }))).toBe(
        "accelerated-canvas",
      );
    }
  });

  it("ignores a canvas the page did not give a WebGL context", () => {
    expect(code(mount("<canvas></canvas>"), env())).toBeNull();
  });
});

describe("root-transform", () => {
  it("applies on every version, 157 and 158 included", () => {
    const root = mount("", "transform: scale(0.5)");
    for (const major of VERSIONS) expect(codeOn(major, root, env())).toBe("root-transform");
  });

  it("ignores a root without a transform", () => {
    expect(code(mount(""), env())).toBeNull();
  });

  it("ignores an identity transform, 2D or 3D, which changes nothing on screen", () => {
    for (const t of [
      "matrix(1, 0, 0, 1, 0, 0)",
      "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)",
    ]) {
      for (const major of VERSIONS)
        expect(codeOn(major, mount("", `transform: ${t}`), env())).toBeNull();
    }
  });

  it("reports a real translate, scale or rotate, 2D or 3D", () => {
    for (const t of [
      "translateX(3px)",
      "scale(1.01)",
      "rotate(1deg)",
      "matrix(1, 0, 0, 1, 0, 2)",
      "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 5, 1)",
    ]) {
      expect(code(mount("", `transform: ${t}`), env())).toBe("root-transform");
    }
  });
});

describe("root-opacity", () => {
  it("applies on every version, 152 included", () => {
    const root = mount("", "opacity: 0.5");
    for (const major of VERSIONS) expect(codeOn(major, root, env())).toBe("root-opacity");
  });

  it("ignores a fully opaque root", () => {
    expect(code(mount("", "opacity: 1"), env())).toBeNull();
  });
});

describe("no version gating", () => {
  // Mutation guard: a defect that once applied only below 157 (or from 155) must still block on
  // 158 (or 152). Reintroducing any from/until test on the Chrome major fails this.
  it("blocks a WebGL canvas, a root transform and a root fade on every version alike", () => {
    const fixtures: Array<[string, () => HTMLElement, DefectEnv]> = [
      ["accelerated-canvas", () => mount("<canvas></canvas>"), env({ isAccelerated: () => true })],
      ["root-transform", () => mount("", "transform: translateX(5px)"), env()],
      ["root-opacity", () => mount("", "opacity: 0.2"), env()],
    ];
    for (const [expected, build, e] of fixtures) {
      const root = build();
      const seen = new Set(VERSIONS.map((major) => codeOn(major, root, e)));
      expect([...seen]).toEqual([expected]);
    }
  });
});

describe("backface-visibility", () => {
  const face = "backface-visibility: hidden";

  it("is found on every version once the scan saw one", () => {
    const root = mount("");
    for (const major of VERSIONS) {
      expect(codeOn(major, root, env({ backface: true }))).toBe("backface-visibility");
    }
  });

  it("scan: a face inside a preserve-3d card", () => {
    const root = mount(
      `<div style="transform-style: preserve-3d"><div style="${face}"></div></div>`,
    );
    expect(scanBackfaceDefect(root)).toBe(true);
  });

  it("scan: a face under a perspective ancestor", () => {
    const root = mount(`<div style="perspective: 800px"><div style="${face}"></div></div>`);
    expect(scanBackfaceDefect(root)).toBe(true);
  });

  it("scan: a face with its own 3D rotation", () => {
    const root = mount(`<div style="${face}; transform: rotateY(180deg)"></div>`);
    expect(scanBackfaceDefect(root)).toBe(true);
  });

  it("scan: the -webkit- spelling counts", () => {
    const root = mount(
      '<div style="transform-style: preserve-3d"><div style="-webkit-backface-visibility: hidden"></div></div>',
    );
    expect(scanBackfaceDefect(root)).toBe(true);
  });

  it("scan: a face found through a stylesheet rule, including inside @media", () => {
    document.head.innerHTML =
      "<style>.card{transform-style:preserve-3d}@media screen{.face{backface-visibility:hidden}}</style>";
    const root = mount('<div class="card"><div class="face"></div></div>');
    expect(scanBackfaceDefect(root)).toBe(true);
  });

  it("scan: the flat performance hack is not a defect", () => {
    document.head.innerHTML = "<style>.perf{backface-visibility:hidden}</style>";
    const root = mount(
      `<div class="perf"></div><div style="${face}; transform: translate3d(0,0,0)"></div>`,
    );
    expect(scanBackfaceDefect(root)).toBe(false);
  });

  it("scan: a 3D card without a hidden face is fine", () => {
    const root = mount('<div style="transform-style: preserve-3d"><div></div></div>');
    expect(scanBackfaceDefect(root)).toBe(false);
  });

  it("scan: a selector that cannot be queried is skipped", () => {
    document.head.innerHTML = "<style>.x::before{backface-visibility:hidden}</style>";
    expect(scanBackfaceDefect(mount("<div class='x'></div>"))).toBe(false);
  });

  it("scan: a 3D context outside the root does not count", () => {
    document.body.innerHTML = `<div style="transform-style: preserve-3d"><div id="root"><div style="${face}"></div></div></div>`;
    const root = document.getElementById("root");
    if (!root) throw new Error("no root");
    expect(scanBackfaceDefect(root)).toBe(false);
  });
});

describe("order", () => {
  it("reports the first applicable defect", () => {
    const root = mount("<canvas layoutsubtree></canvas>", "opacity: 0.5");
    expect(code(root, env({ backface: true }))).toBe("nested-capture-canvas");
  });
});

describe("createDefectScan", () => {
  const face = "backface-visibility: hidden";
  const run = (root: HTMLElement, steps: number, each?: (i: number) => void) => {
    const scan = createDefectScan(root, () => false);
    for (let i = 0; i <= steps; i++) {
      each?.(i);
      scan.sample(i, steps, i / 10);
    }
    return scan.result();
  };

  it("is clean for a quiet timeline", () => {
    expect(run(mount(""), 20)).toBeNull();
  });

  it("names the defect and when it was first seen", () => {
    const root = mount("");
    const found = run(root, 20, (i) => {
      if (i === 7) root.style.opacity = "0.5";
    });
    expect(found?.code).toBe("root-opacity");
    expect(found?.reason).toContain("first seen at t=0.7s");
  });

  it("sees a rotation that a later step applies to a face with no 3D context at the start", () => {
    const root = mount(`<div id="f" style="${face}"></div>`);
    const el = root.querySelector<HTMLElement>("#f");
    const found = run(root, 20, (i) => {
      if (i === 12 && el) el.style.transform = "rotateY(90deg)";
    });
    expect(found?.code).toBe("backface-visibility");
    expect(found?.reason).toContain("first seen at t=2.0s");
  });

  it("leaves a flat face alone however long the timeline", () => {
    const root = mount(`<div style="${face}; transform: translateX(40px)"></div>`);
    expect(run(root, 40)).toBeNull();
  });
});
