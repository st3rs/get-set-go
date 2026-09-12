import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const TARGET_URL = process.env.BROWSER_CAPTURE_URL || 'https://www.raycast.com/';
const NAV_TIMEOUT_MS = Number(process.env.BROWSER_CAPTURE_TIMEOUT_MS || 90_000);
const VIEWPORT_WIDTH = Number(process.env.BROWSER_CAPTURE_WIDTH || 1440);
const VIEWPORT_HEIGHT = Number(process.env.BROWSER_CAPTURE_HEIGHT || 1000);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const rootDir = join(process.cwd(), 'artifacts', 'browser-capture', stamp);
await mkdir(rootDir, { recursive: true });

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
}

let browser;
let page;
const startedAt = Date.now();

console.log(`Local Browser capture started. Artifacts: ${rootDir}`);
console.log(`Target: ${TARGET_URL}`);

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
  });
  page = await context.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  page.setDefaultTimeout(NAV_TIMEOUT_MS);

  const response = await page.goto(TARGET_URL, {
    waitUntil: 'networkidle',
    timeout: NAV_TIMEOUT_MS,
  });

  const html = await page.content();
  const htmlByteLength = Buffer.byteLength(html, 'utf8');
  const imageCount = await page.locator('img').count();
  const finalUrl = page.url();
  const httpStatus = response?.status() ?? null;

  await writeFile(join(rootDir, 'page.html'), html, 'utf8');
  await page.screenshot({
    path: join(rootDir, 'screenshot.png'),
    fullPage: true,
  });

  const proof = {
    proof: 'direct-local-browser-capture-artifacts',
    targetUrl: TARGET_URL,
    finalUrl,
    httpStatus,
    htmlByteLength,
    imageCount,
    elapsedMs: Date.now() - startedAt,
    waitUntil: 'networkidle',
    screenshotFile: 'screenshot.png',
    htmlFile: 'page.html',
    cloudflareBrowserBindingInvolved: false,
    cloudflareWorkerInvolved: false,
    programmaticCaptureComplete: true,
    visualVerification: 'PENDING',
    status: 'ARTIFACTS_WRITTEN_VISUAL_CHECK_REQUIRED',
    passRule: 'Open screenshot.png and confirm it shows the intended target page, not a cookie wall, bot/challenge page, login wall, or blank page.',
  };

  await writeJson(join(rootDir, 'proof.json'), proof);
  console.log(JSON.stringify(proof, null, 2));
  console.log(`Artifacts: ${rootDir}`);
} catch (error) {
  const failure = {
    proof: 'direct-local-browser-capture-artifacts',
    targetUrl: TARGET_URL,
    finalUrl: page?.url?.() || null,
    httpStatus: null,
    htmlByteLength: null,
    imageCount: null,
    elapsedMs: Date.now() - startedAt,
    waitUntil: 'networkidle',
    cloudflareBrowserBindingInvolved: false,
    cloudflareWorkerInvolved: false,
    programmaticCaptureComplete: false,
    visualVerification: 'NOT_AVAILABLE',
    status: 'CAPTURE_FAILED',
    error: String(error?.message || error),
    nextAction: 'If this is bot detection, a challenge, or a navigation wall, change BROWSER_CAPTURE_URL. Do not add stealth plugins or user-agent spoofing.',
  };

  try {
    if (page) {
      const html = await page.content();
      failure.finalUrl = page.url();
      failure.htmlByteLength = Buffer.byteLength(html, 'utf8');
      failure.imageCount = await page.locator('img').count().catch(() => null);
      await writeFile(join(rootDir, 'page.html'), html, 'utf8');
      await page.screenshot({ path: join(rootDir, 'screenshot.png'), fullPage: true }).catch(() => {});
    }
  } catch {}

  await writeJson(join(rootDir, 'proof.json'), failure);
  console.error(JSON.stringify(failure, null, 2));
  console.error(`Artifacts: ${rootDir}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
}
