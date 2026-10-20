import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import puppeteer, { type Browser } from "puppeteer-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ensureBrowser } from "../browser/manager.js";
import { extractTokens } from "./tokenExtractor.js";

// Tailwind v4 writes its palette in oklch, so every sampled color takes the canvas path.
const SWATCHES = Array.from(
  { length: 60 },
  (_, i) =>
    `<div style="height:8px;background:oklch(${(0.3 + i / 100).toFixed(2)} 0.15 ${i * 6})">x</div>`,
).join("");
const HTML = `<!doctype html><html><body style="background:oklch(1 0 0)">
<h1 style="color:oklch(0.6279554 0.2576833 29.2338851)">Red</h1>${SWATCHES}</body></html>`;

let browser: Browser;
const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(HTML);
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { executablePath } = await ensureBrowser();
  browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
}, 60_000);

afterAll(async () => {
  server.closeAllConnections();
  server.close();
  await browser?.close();
});

it("resolves oklch colors through one CPU-readable canvas, not one GPU canvas per color", async () => {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(`
    window.__contexts2d = [];
    var getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      if (type === "2d") window.__contexts2d.push(!!(attrs && attrs.willReadFrequently));
      return getContext.call(this, type, attrs);
    };
  `);
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);

  const tokens = await extractTokens(page);

  expect(await page.evaluate(`window.__contexts2d`)).toEqual([true]);
  expect(tokens.colors).toEqual(expect.arrayContaining(["#FF0000", "#FFFFFF"]));
  await page.close();
});
