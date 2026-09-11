interface Env {
  BROWSER_API: Fetcher;
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  if (!context.env.BROWSER_API) return json({ ok: false, stage: 'pages-binding', error: 'BROWSER_API service binding is not configured' }, 500);
  try {
    const response = await context.env.BROWSER_API.fetch(new Request('https://get-set-go-api.internal/smoke-image', { method: 'POST' }));
    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return json({ ok: false, stage: 'service-binding', error: error instanceof Error ? error.message : 'Smoke-image proxy failed' }, 502);
  }
};

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  return onRequestPost(context);
};
