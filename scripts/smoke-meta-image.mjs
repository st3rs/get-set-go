import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const API_URL = 'https://api.meta.ai/v1/responses';
const MODEL = process.env.MUSE_IMAGE_MODEL || 'muse-image-1.0';
const PROMPT = process.env.MUSE_IMAGE_SMOKE_PROMPT || 'a simple product photo of a white chair';
const TIMEOUT_MS = Number(process.env.MUSE_IMAGE_SMOKE_TIMEOUT_MS || 180_000);
const API_KEY = process.env.MODEL_API_KEY;

if (!API_KEY) {
  console.error('MODEL_API_KEY is not set. This proof script intentionally reads only the raw Meta key from the local environment.');
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(process.cwd(), 'artifacts', 'meta-image-smoke', stamp);
await mkdir(outDir, { recursive: true });

function findImageBase64(payload) {
  for (const item of payload?.output || []) {
    if (item?.type === 'image_generation_call' && typeof item.result === 'string') return item.result;
    for (const content of item?.content || []) {
      if (content?.type === 'image_generation_call' && typeof content.result === 'string') return content.result;
    }
  }
  return null;
}

function detectMime(buffer) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mimeType: 'image/webp', extension: 'webp' };
  }
  return null;
}

async function saveProof(proof) {
  await writeFile(join(outDir, 'proof.json'), JSON.stringify(proof, null, 2), 'utf8');
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
const startedAt = Date.now();

let response;
let rawText = '';
try {
  response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      input: PROMPT,
    }),
    signal: controller.signal,
  });
  rawText = await response.text();
} catch (error) {
  clearTimeout(timer);
  const proof = {
    ok: false,
    stage: 'direct-meta-request',
    model: MODEL,
    apiUrl: API_URL,
    elapsedMs: Date.now() - startedAt,
    error: controller.signal.aborted ? `Direct Meta request timed out after ${TIMEOUT_MS}ms` : String(error?.message || error),
    cloudflareInvolved: false,
  };
  await saveProof(proof);
  console.error(JSON.stringify(proof, null, 2));
  console.error(`Artifacts: ${outDir}`);
  process.exit(3);
} finally {
  clearTimeout(timer);
}

const contentType = response.headers.get('content-type') || '';
const rawFile = contentType.includes('application/json') ? 'raw-response.json' : 'raw-response.txt';
await writeFile(join(outDir, rawFile), rawText, 'utf8');

let payload = null;
try {
  payload = JSON.parse(rawText);
} catch {
  // Keep the raw body as the authoritative artifact.
}

if (!response.ok) {
  const proof = {
    ok: false,
    stage: 'meta-entitlement-or-request',
    model: MODEL,
    apiUrl: API_URL,
    httpStatus: response.status,
    httpStatusText: response.statusText,
    contentType,
    rawResponseBytes: Buffer.byteLength(rawText),
    elapsedMs: Date.now() - startedAt,
    classification: response.status === 403 || response.status === 404
      ? 'model-not-entitled-or-not-available-for-this-key'
      : 'meta-api-error',
    errorBody: payload || rawText.slice(0, 4000),
    cloudflareInvolved: false,
  };
  await saveProof(proof);
  console.error(JSON.stringify(proof, null, 2));
  console.error(`Artifacts: ${outDir}`);
  process.exit(4);
}

if (!payload) {
  const proof = {
    ok: false,
    stage: 'meta-response-parse',
    model: MODEL,
    httpStatus: response.status,
    rawResponseBytes: Buffer.byteLength(rawText),
    elapsedMs: Date.now() - startedAt,
    error: 'Meta returned HTTP 2xx but the response body was not valid JSON.',
    cloudflareInvolved: false,
  };
  await saveProof(proof);
  console.error(JSON.stringify(proof, null, 2));
  console.error(`Artifacts: ${outDir}`);
  process.exit(5);
}

const base64 = findImageBase64(payload);
if (!base64) {
  const proof = {
    ok: false,
    stage: 'meta-image-result',
    model: MODEL,
    httpStatus: response.status,
    rawResponseBytes: Buffer.byteLength(rawText),
    elapsedMs: Date.now() - startedAt,
    error: 'HTTP 2xx received, but no image_generation_call.result was found.',
    outputTypes: Array.isArray(payload.output) ? payload.output.map((item) => item?.type || 'unknown') : [],
    cloudflareInvolved: false,
  };
  await saveProof(proof);
  console.error(JSON.stringify(proof, null, 2));
  console.error(`Artifacts: ${outDir}`);
  process.exit(6);
}

const imageBytes = Buffer.from(base64, 'base64');
const detected = detectMime(imageBytes);
const magicHex = imageBytes.subarray(0, 16).toString('hex').match(/.{1,2}/g)?.join(' ') || '';

if (!detected) {
  const proof = {
    ok: false,
    stage: 'image-magic-bytes',
    model: MODEL,
    httpStatus: response.status,
    imageByteLength: imageBytes.length,
    magicHex,
    elapsedMs: Date.now() - startedAt,
    error: 'Image bytes were returned but PNG/JPEG/WebP magic bytes were not recognized.',
    cloudflareInvolved: false,
  };
  await writeFile(join(outDir, 'image-unrecognized.bin'), imageBytes);
  await saveProof(proof);
  console.error(JSON.stringify(proof, null, 2));
  console.error(`Artifacts: ${outDir}`);
  process.exit(7);
}

const imageFile = `image.${detected.extension}`;
await writeFile(join(outDir, imageFile), imageBytes);

const proof = {
  ok: true,
  proof: 'direct-meta-muse-image-bytes',
  model: MODEL,
  apiUrl: API_URL,
  prompt: PROMPT,
  httpStatus: response.status,
  contentType,
  rawResponseBytes: Buffer.byteLength(rawText),
  imageByteLength: imageBytes.length,
  mimeType: detected.mimeType,
  imageFile,
  magicHex,
  elapsedMs: Date.now() - startedAt,
  cloudflareInvolved: false,
};
await saveProof(proof);

console.log(JSON.stringify(proof, null, 2));
console.log(`Artifacts: ${outDir}`);
