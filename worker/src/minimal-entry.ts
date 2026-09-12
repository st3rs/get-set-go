import type { BrowserWorker } from '@cloudflare/playwright';
import { handleMinimalRebuild, handleSmokeImage } from './minimal';

// Compatibility export only. The existing Cloudflare Worker owns Durable Objects
// implemented by GenerationJob, so Cloudflare refuses a new version that drops
// this class without an explicit destructive migration. Re-export the proven
// legacy implementation to preserve those objects while keeping the minimal
// default request path completely independent of JOBS / Durable Objects.
export { GenerationJob } from './index';

interface Env {
  BROWSER: BrowserWorker;
  MODEL_API_KEY?: string;
  MUSE_SPARK_MODEL?: string;
  MUSE_IMAGE_MODEL?: string;
  FRONTEND_ORIGIN?: string;
}

function cors(env: Env) {
  return {
    'Access-Control-Allow-Origin': env.FRONTEND_ORIGIN || 'https://get-set-go.pages.dev',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  };
}

function withCors(response: Response, env: Env) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors(env))) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

function json(env: Env, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors(env) },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json(env, {
        ok: true,
        service: 'get-set-go-api',
        version: 'minimal-slice-v1',
        pipeline: 'single-request proof-first slice',
        backgroundJobs: false,
        durableObjectsInMinimalRequestPath: false,
        legacyGenerationJobExportPreserved: true,
        critic: false,
        registry: false,
        geometryGate: false,
        modelKeyConfigured: Boolean(env.MODEL_API_KEY),
        sparkModel: env.MUSE_SPARK_MODEL || 'muse-spark-1.3',
        imageModel: env.MUSE_IMAGE_MODEL || 'muse-image-1.0',
      });
    }

    if (url.pathname === '/smoke-image' && request.method === 'POST') {
      return withCors(await handleSmokeImage(env), env);
    }

    if (url.pathname === '/minimal-rebuild' && request.method === 'POST') {
      return withCors(await handleMinimalRebuild(request, env), env);
    }

    return json(env, {
      ok: true,
      service: 'get-set-go-api',
      version: 'minimal-slice-v1',
      endpoints: {
        health: 'GET /health',
        smokeImage: 'POST /smoke-image',
        minimalRebuild: 'POST /minimal-rebuild { url }',
      },
    });
  },
} satisfies ExportedHandler<Env>;
