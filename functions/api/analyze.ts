interface Env {
  BROWSER_API: Fetcher;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = await context.request.text();

  const upstream = new Request('https://get-set-go-api.internal/analyze', {
    method: 'POST',
    headers: {
      'content-type': context.request.headers.get('content-type') || 'application/json',
    },
    body,
  });

  const response = await context.env.BROWSER_API.fetch(upstream);

  return new Response(response.body, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
};

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json; charset=utf-8', 'allow': 'POST' },
    });
  }

  return onRequestPost(context);
};
