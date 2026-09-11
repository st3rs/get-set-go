import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const API_URL = 'https://api.meta.ai/v1/responses';
const API_KEY = process.env.MODEL_API_KEY;
const SPARK_MODEL = process.env.MUSE_SPARK_MODEL || 'muse-spark-1.3';
const IMAGE_MODEL = process.env.MUSE_IMAGE_MODEL || 'muse-image-1.0';
const SPARK_PROMPT = process.env.MUSE_SPARK_CONTROL_PROMPT || 'Reply with exactly CONTROL_OK.';
const IMAGE_PROMPT = process.env.MUSE_IMAGE_SMOKE_PROMPT || 'a simple product photo of a white chair';
const TIMEOUT_MS = Number(process.env.META_PROOF_TIMEOUT_MS || 180_000);

if (!API_KEY) {
  console.error('MODEL_API_KEY is not set. This script only performs direct Meta API calls and intentionally does not read Cloudflare configuration.');
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const rootDir = join(process.cwd(), 'artifacts', 'meta-model-proof', stamp);
await mkdir(rootDir, { recursive: true });

function classifyHttp(status) {
  if (status === 400) return {
    classification: 'invalid-request-or-surface-contract',
    nextAction: 'Inspect the raw response and request payload. This is a request/API-contract problem, not entitlement proof.',
  };
  if (status === 401) return {
    classification: 'invalid-or-unaccepted-api-key',
    nextAction: 'Verify the raw MODEL_API_KEY. Do not change Get Set Go code.',
  };
  if (status === 403) return {
    classification: 'forbidden-auth-entitlement-policy-or-geo',
    nextAction: 'Do not repair request plumbing. Compare with the Spark control result to separate general key/region access from image-model entitlement.',
  };
  if (status === 404) return {
    classification: 'model-not-served-on-this-meta-api-surface',
    nextAction: 'Do not request access or keep changing payload shape. Move this model call to a provider that serves Muse Image, such as fal or an AI gateway.',
  };
  if (status === 429) return {
    classification: 'rate-limited',
    nextAction: 'Retry later. This result proves neither entitlement nor lack of entitlement.',
  };
  if (status >= 500) return {
    classification: 'meta-upstream-error',
    nextAction: 'Retry later. Do not change the application architecture based on this response.',
  };
  return {
    classification: `http-${status}`,
    nextAction: 'Inspect the raw response artifact before changing code.',
  };
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  const parts = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

function findImageBase64(payload) {
  for (const item of payload?.output || []) {
    if (item?.type === 'image_generation_call' && typeof item.result === 'string') return item.result;
    for (const content of item?.content || []) {
      if (content?.type === 'image_generation_call' && typeof content.result === 'string') return content.result;
    }
  }
  return null;
}

function detectImage(buffer) {
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

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
}

async function directCall({ name, model, input, kind }) {
  const outDir = join(rootDir, name);
  await mkdir(outDir, { recursive: true });
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  let rawText = '';
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, input }),
      signal: controller.signal,
    });
    rawText = await response.text();
  } catch (error) {
    const proof = {
      ok: false,
      name,
      kind,
      model,
      apiUrl: API_URL,
      stage: 'direct-request',
      classification: controller.signal.aborted ? 'direct-request-timeout' : 'network-or-runtime-error',
      elapsedMs: Date.now() - startedAt,
      error: controller.signal.aborted ? `Direct request timed out after ${TIMEOUT_MS}ms` : String(error?.message || error),
      cloudflareInvolved: false,
    };
    await writeJson(join(outDir, 'proof.json'), proof);
    return proof;
  } finally {
    clearTimeout(timer);
  }

  const contentType = response.headers.get('content-type') || '';
  const rawName = contentType.includes('application/json') ? 'raw-response.json' : 'raw-response.txt';
  await writeFile(join(outDir, rawName), rawText, 'utf8');

  let payload = null;
  try { payload = JSON.parse(rawText); } catch {}

  if (!response.ok) {
    const classified = classifyHttp(response.status);
    const proof = {
      ok: false,
      name,
      kind,
      model,
      apiUrl: API_URL,
      stage: 'meta-http-response',
      httpStatus: response.status,
      httpStatusText: response.statusText,
      contentType,
      rawResponseBytes: Buffer.byteLength(rawText),
      elapsedMs: Date.now() - startedAt,
      ...classified,
      errorBody: payload || rawText.slice(0, 8000),
      cloudflareInvolved: false,
    };
    await writeJson(join(outDir, 'proof.json'), proof);
    return proof;
  }

  if (!payload) {
    const proof = {
      ok: false,
      name,
      kind,
      model,
      apiUrl: API_URL,
      stage: 'response-parse',
      httpStatus: response.status,
      classification: 'http-2xx-non-json-response',
      rawResponseBytes: Buffer.byteLength(rawText),
      elapsedMs: Date.now() - startedAt,
      error: 'Meta returned HTTP 2xx but the response body was not valid JSON.',
      cloudflareInvolved: false,
    };
    await writeJson(join(outDir, 'proof.json'), proof);
    return proof;
  }

  if (kind === 'spark') {
    const outputText = extractOutputText(payload);
    const proof = outputText
      ? {
          ok: true,
          proof: 'direct-meta-spark-control',
          name,
          kind,
          model,
          apiUrl: API_URL,
          httpStatus: response.status,
          outputText,
          rawResponseBytes: Buffer.byteLength(rawText),
          elapsedMs: Date.now() - startedAt,
          cloudflareInvolved: false,
        }
      : {
          ok: false,
          name,
          kind,
          model,
          apiUrl: API_URL,
          stage: 'spark-output',
          httpStatus: response.status,
          classification: 'spark-returned-no-output-text',
          rawResponseBytes: Buffer.byteLength(rawText),
          elapsedMs: Date.now() - startedAt,
          error: 'Spark returned HTTP 2xx but no output text was found.',
          cloudflareInvolved: false,
        };
    await writeJson(join(outDir, 'proof.json'), proof);
    return proof;
  }

  const base64 = findImageBase64(payload);
  if (!base64) {
    const proof = {
      ok: false,
      name,
      kind,
      model,
      apiUrl: API_URL,
      stage: 'image-output',
      httpStatus: response.status,
      classification: 'http-2xx-without-image-generation-result',
      rawResponseBytes: Buffer.byteLength(rawText),
      outputTypes: Array.isArray(payload.output) ? payload.output.map((item) => item?.type || 'unknown') : [],
      elapsedMs: Date.now() - startedAt,
      error: 'HTTP 2xx received, but no image_generation_call.result was found.',
      cloudflareInvolved: false,
    };
    await writeJson(join(outDir, 'proof.json'), proof);
    return proof;
  }

  const imageBytes = Buffer.from(base64, 'base64');
  const detected = detectImage(imageBytes);
  const magicHex = imageBytes.subarray(0, 16).toString('hex').match(/.{1,2}/g)?.join(' ') || '';

  if (!detected) {
    await writeFile(join(outDir, 'image-unrecognized.bin'), imageBytes);
    const proof = {
      ok: false,
      name,
      kind,
      model,
      apiUrl: API_URL,
      stage: 'image-magic-bytes',
      httpStatus: response.status,
      classification: 'unrecognized-image-bytes',
      imageByteLength: imageBytes.length,
      magicHex,
      elapsedMs: Date.now() - startedAt,
      error: 'Image bytes were returned, but PNG/JPEG/WebP magic bytes were not recognized.',
      cloudflareInvolved: false,
    };
    await writeJson(join(outDir, 'proof.json'), proof);
    return proof;
  }

  const imageFile = `image.${detected.extension}`;
  await writeFile(join(outDir, imageFile), imageBytes);
  const proof = {
    ok: true,
    proof: 'direct-meta-muse-image-bytes',
    name,
    kind,
    model,
    apiUrl: API_URL,
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
  await writeJson(join(outDir, 'proof.json'), proof);
  return proof;
}

function decide(spark, image) {
  if (spark.ok && image.ok) {
    return {
      classification: 'spark-and-image-direct-meta-pass',
      nextAction: 'Proceed to local Browser → Spark → Image → output.html slice. Cloudflare remains out of the proof path.',
    };
  }

  if (spark.ok && image.httpStatus === 404) {
    return {
      classification: 'spark-works-image-not-served-on-meta-responses-surface',
      nextAction: 'Keep Spark on Meta and move only museImageRequest() to fal or another provider that explicitly serves Muse Image.',
    };
  }

  if (spark.ok && image.httpStatus === 403) {
    return {
      classification: 'spark-works-image-forbidden',
      nextAction: 'The key and Spark surface work. Treat this as image-model entitlement/policy restriction unless Meta documentation for the account says otherwise; do not debug Cloudflare.',
    };
  }

  if (spark.httpStatus === 403) {
    return {
      classification: 'spark-control-forbidden',
      nextAction: 'Investigate key/account/region access first. Image entitlement cannot be isolated from this run.',
    };
  }

  if (spark.httpStatus === 401) {
    return {
      classification: 'spark-control-key-rejected',
      nextAction: 'Fix the raw Meta API key before touching any Get Set Go code.',
    };
  }

  if (spark.httpStatus === 400) {
    return {
      classification: 'spark-control-request-contract-failed',
      nextAction: 'Inspect Spark raw-response.json and the direct request contract before drawing conclusions about model access.',
    };
  }

  return {
    classification: 'inconclusive-see-two-proof-files',
    nextAction: 'Read spark/proof.json and image/proof.json independently. Do not change Cloudflare plumbing based on this result.',
  };
}

console.log(`Direct Meta proof started. Artifacts: ${rootDir}`);
console.log(`1/2 Spark control: ${SPARK_MODEL}`);
const spark = await directCall({ name: 'spark', model: SPARK_MODEL, input: SPARK_PROMPT, kind: 'spark' });
console.log(JSON.stringify(spark, null, 2));

console.log(`2/2 Muse Image: ${IMAGE_MODEL}`);
const image = await directCall({ name: 'image', model: IMAGE_MODEL, input: IMAGE_PROMPT, kind: 'image' });
console.log(JSON.stringify(image, null, 2));

const decision = decide(spark, image);
const summary = {
  ok: Boolean(spark.ok && image.ok),
  proof: 'direct-meta-two-model-control',
  apiUrl: API_URL,
  cloudflareInvolved: false,
  spark: {
    ok: Boolean(spark.ok),
    model: SPARK_MODEL,
    httpStatus: spark.httpStatus ?? null,
    classification: spark.classification || spark.proof || null,
    proofFile: 'spark/proof.json',
  },
  image: {
    ok: Boolean(image.ok),
    model: IMAGE_MODEL,
    httpStatus: image.httpStatus ?? null,
    classification: image.classification || image.proof || null,
    proofFile: 'image/proof.json',
  },
  ...decision,
};
await writeJson(join(rootDir, 'summary.json'), summary);

console.log(JSON.stringify(summary, null, 2));
console.log(`Artifacts: ${rootDir}`);
process.exit(summary.ok ? 0 : 1);
