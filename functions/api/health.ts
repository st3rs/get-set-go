interface Env {
  BROWSER_API: Fetcher;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  if (!context.env.BROWSER_API) {
    return new Response(JSON.stringify({ ok: false, stage: 'pages-binding', error: 'BROWSER_API service binding is not configured' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  try {
    const upstream = new Request('https://get-set-go-api.internal/health', { method: 'GET' });
    const response = await context.env.BROWSER_API.fetch(upstream);
    const text = await response.text();

    return new Response(text, {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Service binding health check failed';
    return new Response(JSON.stringify({ ok: false, stage: 'service-binding', error: message }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
};

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method !== 'GET') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json; charset=utf-8', 'allow': 'GET' },
    });
  }

  return onRequestGet(context);
};
