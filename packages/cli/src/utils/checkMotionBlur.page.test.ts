// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readMotionBlurProbe } from "./checkMotionBlur.js";

const report = { state: "off", reason: "why", reasonCode: "root-transform", movers: 3 };

function page(attr: string | null, withApi = true) {
  document.body.innerHTML = `<div data-composition-id="main" ${attr === null ? "" : `data-motion-blur="${attr}"`}></div>`;
  const probe = vi.fn(() => report);
  if (withApi) Reflect.set(window, "__hfMotionBlur", { probe });
  return probe;
}

afterEach(() => {
  Reflect.deleteProperty(window, "__hfMotionBlur");
  document.body.innerHTML = "";
});

describe("readMotionBlurProbe", () => {
  it("calls the runtime probe for a root that asked for blur and returns its report", () => {
    const probe = page("on");
    expect(readMotionBlurProbe()).toEqual(report);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it.each([null, "off"])("never calls the probe when the root attribute is %s", (attr) => {
    const probe = page(attr);
    expect(readMotionBlurProbe()).toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });

  it("reads nothing when the runtime exposes no probe", () => {
    page("on", false);
    expect(readMotionBlurProbe()).toBeNull();
  });
});
