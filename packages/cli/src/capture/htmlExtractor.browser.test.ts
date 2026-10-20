import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import puppeteer, { type Browser } from "puppeteer-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ensureBrowser } from "../browser/manager.js";
import { extractHtml } from "./htmlExtractor.js";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#c33"/></svg>`;

let browser: Browser;
let page: Server;
let images: Server;
const port = (server: Server) => (server.address() as AddressInfo).port;

beforeAll(async () => {
  images = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Access-Control-Allow-Origin": "*" });
    res.end(SVG);
  });
  page = createServer((_req, res) => {
    const imgs = [1, 2, 3]
      .map((n) => `<img crossorigin="anonymous" src="http://127.0.0.1:${port(images)}/${n}.svg">`)
      .join("");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><body>${imgs}</body></html>`);
  });
  await Promise.all(
    [images, page].map((s) => new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve))),
  );
  const { executablePath } = await ensureBrowser();
  browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
}, 60_000);

afterAll(async () => {
  for (const s of [page, images]) {
    s.closeAllConnections();
    s.close();
  }
  await browser?.close();
});

/** Lengths of the data URLs extractHtml put in place of the three cross-origin images. */
async function inlinedImages(inlineImageBudgetChars?: number): Promise<number[]> {
  const tab = await browser.newPage();
  await tab.goto(`http://127.0.0.1:${port(page)}/`, { waitUntil: "networkidle0" });
  const { bodyHtml } = await extractHtml(tab, { settleTime: 0, inlineImageBudgetChars });
  await tab.close();
  return [...bodyHtml.matchAll(/src="(data:image\/[^"]+)"/g)].map((m) => m[1]!.length);
}

it("inlines cross-origin images into page.html until the budget runs out", async () => {
  const all = await inlinedImages();
  expect(all).toHaveLength(3);
  // Room for one image and not a second: the rest keep their absolute URL.
  expect(await inlinedImages(all[0]! * 2 - 1)).toHaveLength(1);
});
