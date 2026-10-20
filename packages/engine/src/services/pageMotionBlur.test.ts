import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PAGE_DEVICE_SCALE_GLOBAL, PAGE_MOTION_BLUR_OFF_GLOBAL } from "@hyperframes/core";
import { describePageMotionBlur, installPageMotionBlur } from "./pageMotionBlur";

const fakePage = () => ({ evaluateOnNewDocument: vi.fn(async () => ({ identifier: "1" })) });

describe("installPageMotionBlur", () => {
  it("tells the page to stand down when the engine blurs", async () => {
    const page = fakePage();
    await installPageMotionBlur(page, { motionBlur: { samplesPerFrame: 16 } });
    expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
    expect(page.evaluateOnNewDocument).toHaveBeenCalledWith(
      expect.any(Function),
      PAGE_MOTION_BLUR_OFF_GLOBAL,
      "engine-motion-blur",
    );
  });

  it("turns the page off when the Studio preview could not blur", async () => {
    const page = fakePage();
    await installPageMotionBlur(page, { pageMotionBlur: "off" });
    expect(page.evaluateOnNewDocument).toHaveBeenCalledWith(
      expect.any(Function),
      PAGE_MOTION_BLUR_OFF_GLOBAL,
      "preview-unsupported",
    );
  });

  it("says why when the render route cannot host the blur", async () => {
    for (const route of ["hdr-render", "layered-composite"] as const) {
      const page = fakePage();
      await installPageMotionBlur(page, { pageMotionBlur: route });
      expect(page.evaluateOnNewDocument).toHaveBeenCalledWith(
        expect.any(Function),
        PAGE_MOTION_BLUR_OFF_GLOBAL,
        route,
      );
    }
  });

  it("tells the page the render's device scale when it is not 1", async () => {
    const page = fakePage();
    await installPageMotionBlur(page, { deviceScaleFactor: 2 });
    expect(page.evaluateOnNewDocument).toHaveBeenCalledWith(
      expect.any(Function),
      PAGE_DEVICE_SCALE_GLOBAL,
      2,
    );
  });

  it("leaves the page alone otherwise", async () => {
    const page = fakePage();
    await installPageMotionBlur(page, {});
    expect(page.evaluateOnNewDocument).not.toHaveBeenCalled();
  });
});

describe("describePageMotionBlur", () => {
  afterEach(() => vi.unstubAllGlobals());
  // Runs the page-side function in this process, with `window` standing in for the page.
  const inPage = { evaluate: async (fn: () => unknown) => fn() } as never;

  it("summarises the runtime's report in one line", async () => {
    vi.stubGlobal("window", {
      __hfMotionBlur: { report: () => ({ state: "off", reasonCode: "renderer-off", movers: 0 }) },
    });
    expect(await describePageMotionBlur(inPage)).toBe(
      "[motion-blur] off reasonCode=renderer-off movers=0",
    );
  });

  it("reports a running blur with its movers", async () => {
    vi.stubGlobal("window", {
      __hfMotionBlur: { report: () => ({ state: "on", reasonCode: null, movers: 24 }) },
    });
    expect(await describePageMotionBlur(inPage)).toBe("[motion-blur] on reasonCode=null movers=24");
  });

  it("says nothing when the page never asked for blur", async () => {
    vi.stubGlobal("window", {});
    expect(await describePageMotionBlur(inPage)).toBeNull();
  });
});

describe("the per-session blur line", () => {
  // Reachability: the line is only worth having if a capture session emits it once, after its first frame.
  it("is logged from the frame capture core after a session's first frame", () => {
    const source = readFileSync(join(__dirname, "frameCapture.ts"), "utf8");
    expect(source).toMatch(
      /capturePerf\.frames === 1\) \{\s*const blur = await describePageMotionBlur\(/,
    );
  });
});
