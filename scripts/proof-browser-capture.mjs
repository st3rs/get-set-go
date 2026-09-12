import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const TARGET_URL = process.env.BROWSER_CAPTURE_URL || 'https://www.raycast.com/';
const LIGHTPANDA_WS_ENDPOINT = process.env.LIGHTPANDA_WS_ENDPOINT || 'ws://127.0.0.1:9222';
const NAV_TIMEOUT_MS = Number(process.env.BROWSER_CAPTURE_TIMEOUT_MS || 90_000);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const rootDir = join(process.cwd(), 'artifacts', 'browser-capture', stamp);
await mkdir(rootDir, { recursive: true });

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
}

let browser;
let page;
const startedAt = Date.now();

console.log(`Local Lightpanda capture started. Artifacts: ${rootDir}`);
console.log(`Target: ${TARGET_URL}`);
console.log(`Lightpanda CDP: ${LIGHTPANDA_WS_ENDPOINT}`);

try {
  browser = await puppeteer.connect({
    browserWSEndpoint: LIGHTPANDA_WS_ENDPOINT,
  });

  const context = await browser.createBrowserContext();
  page = await context.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  page.setDefaultTimeout(NAV_TIMEOUT_MS);

  const response = await page.goto(TARGET_URL, {
    waitUntil: 'networkidle0',
    timeout: NAV_TIMEOUT_MS,
  });

  const html = await page.content();
  const htmlByteLength = Buffer.byteLength(html, 'utf8');
  const imageCount = await page.evaluate(() => document.querySelectorAll('img').length);
  const finalUrl = page.url();
  const httpStatus = response?.status() ?? null;

  await writeFile(join(rootDir, 'page.html'), html, 'utf8');

  const cdp = await page.createCDPSession();
  const screenshot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });
  const screenshotBytes = Buffer.from(screenshot.data, 'base64');
  await writeFile(join(rootDir, 'screenshot.png'), screenshotBytes);

  const proof = {
    proof: 'direct-local-lightpanda-browser-capture',
    browserEngine: 'lightpanda',
    transport: 'CDP',
    lightpandaWsEndpoint: LIGHTPANDA_WS_ENDPOINT,
    targetUrl: TARGET_URL,
    finalUrl,
    httpStatus,
    htmlByteLength,
    imageCount,
    screenshotByteLength: screenshotBytes.length,
    elapsedMs: Date.now() - startedAt,
    waitUntil: 'networkidle0',
    screenshotFile: 'screenshot.png',
    htmlFile: 'page.html',
    cloudflareBrowserBindingInvolved: false,
    cloudflareWorkerInvolved: false,
    playwrightInvolved: false,
    programmaticCaptureComplete: true,
    screenshotSemantics: 'Lightpanda text-only rasterization; Lightpanda has no CSS/layout engine.',
    suitableAsPixelReference: false,
    visualVerification: 'PENDING_SANITY_CHECK_ONLY',
    status: 'ARTIFACTS_WRITTEN_SANITY_CHECK_REQUIRED',
    passRule: 'Open screenshot.png and confirm the captured text/DOM belongs to the intended target rather than a bot challenge, cookie/login wall, or blank/error page. Do not treat this PNG as a pixel-accurate visual reference.',
  };

  await writeJson(join(rootDir, 'proof.json'), proof);
  console.log(JSON.stringify(proof, null, 2));
  console.log(`Artifacts: ${rootDir}`);

  await page.close();
  await context.close();
} catch (error) {
  const failure = {
    proof: 'direct-local-lightpanda-browser-capture',
    browserEngine: 'lightpanda',
    transport: 'CDP',
    lightpandaWsEndpoint: LIGHTPANDA_WS_ENDPOINT,
    targetUrl: TARGET_URL,
    finalUrl: page?.url?.() || null,
    httpStatus: null,
    htmlByteLength: null,
    imageCount: null,
    screenshotByteLength: null,
    elapsedMs: Date.now() - startedAt,
    waitUntil: 'networkidle0',
    cloudflareBrowserBindingInvolved: false,
    cloudflareWorkerInvolved: false,
    playwrightInvolved: false,
    programmaticCaptureComplete: false,
    suitableAsPixelReference: false,
    visualVerification: 'NOT_AVAILABLE',
    status: 'CAPTURE_FAILED',
    error: String(error?.message || error),
    nextAction: `First verify Lightpanda is serving CDP at ${LIGHTPANDA_WS_ENDPOINT}. If the target itself blocks automation, change BROWSER_CAPTURE_URL instead of adding stealth or user-agent spoofing.`,
  };

  try {
    if (page) {
      const html = await page.content();
      failure.finalUrl = page.url();
      failure.htmlByteLength = Buffer.byteLength(html, 'utf8');
      failure.imageCount = await page.evaluate(() => document.querySelectorAll('img').length).catch(() => null);
      await writeFile(join(rootDir, 'page.html'), html, 'utf8');

      const cdp = await page.createCDPSession().catch(() => null);
      if (cdp) {
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }).catch(() => null);
        if (shot?.data) {
          const bytes = Buffer.from(shot.data, 'base64');
          failure.screenshotByteLength = bytes.length;
          await writeFile(join(rootDir, 'screenshot.png'), bytes);
        }
      }
    }
  } catch {}

  await writeJson(join(rootDir, 'proof.json'), failure);
  console.error(JSON.stringify(failure, null, 2));
  console.error(`Artifacts: ${rootDir}`);
  process.exitCode = 1;
} finally {
  await browser?.disconnect().catch(() => {});
}
