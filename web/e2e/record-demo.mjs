// Record the live dashboard for ~75 s (long enough to catch a 2-minute plan paying) to docs/demo.webm.
// Usage: cd web && npm run build && node e2e/record-demo.mjs [seconds]
import { createRequire } from "node:module";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = createRequire(import.meta.url)("playwright");

const here = path.dirname(fileURLToPath(import.meta.url));
const seconds = Number(process.argv[2] ?? 75);
const outDir = path.join(here, "..", "..", "docs");
const tmp = path.join(here, "out", "video");
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
const port = 4175;
const server = spawn(path.join(here, "..", "node_modules", ".bin", "vite"), ["preview", "--port", String(port), "--strictPort"], { cwd: path.join(here, ".."), stdio: ["ignore", "ignore", "inherit"] });
await new Promise((r) => setTimeout(r, 2500));
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined;
const browser = await chromium.launch({ proxy, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, recordVideo: { dir: tmp, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage();
await page.goto(`http://localhost:${port}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".plan");
// Slow scroll through the page, then sit on the plan list to catch a payout landing.
for (let y = 0; y <= 900; y += 150) {
  await page.mouse.wheel(0, 150);
  await page.waitForTimeout(700);
}
await page.waitForTimeout(3000);
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await page.waitForTimeout(Math.max(0, seconds * 1000 - 12_000));
await ctx.close();
await browser.close();
server.kill();
const webm = fs.readdirSync(tmp).find((f) => f.endsWith(".webm"));
fs.copyFileSync(path.join(tmp, webm), path.join(outDir, "demo.webm"));
try {
  execSync(`ffmpeg -y -loglevel error -i "${path.join(outDir, "demo.webm")}" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${path.join(outDir, "demo.mp4")}"`);
  console.log("wrote docs/demo.webm and docs/demo.mp4");
} catch {
  console.log("wrote docs/demo.webm (ffmpeg not available for mp4)");
}
