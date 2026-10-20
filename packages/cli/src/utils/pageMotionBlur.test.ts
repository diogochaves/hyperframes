import { describe, expect, it } from "vitest";
import { renderPageMotionBlur } from "./pageMotionBlur.js";

describe("renderPageMotionBlur", () => {
  it("turns blur off when the Studio preview could not show it", () => {
    expect(renderPageMotionBlur(false)).toBe("off");
  });

  it("leaves it to the root's opt-in otherwise", () => {
    expect(renderPageMotionBlur(true)).toBeUndefined();
    expect(renderPageMotionBlur()).toBeUndefined();
  });
});
