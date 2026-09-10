interface Env {
  BROWSER_API?: Fetcher;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    if (!context.env.BROWSER_API) {
      return json({
        ok: false,
        error: 'BROWSER_API service binding is not configured on the Pages project.',
        action: 'Cloudflare Pages > get-set-go > Settings > Bindings > Add > Service binding > Variable name BROWSER_API > Service get-set-go-api > Redeploy',
      }, 503);
    }

    const body = await context.request.text();

    const upstream = new Request('https://get-set-go-api.internal/analyze', {
      method: 'POST',
      headers: {
        'content-type': context.request.headers.get('content-type') || 'application/json',
      },
      body,
    });

    const response = await context.env.BROWSER_API.fetch(upstream);
    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      return json({
        ok: false,
        error: 'Browser worker returned a non-JSON response.',
        upstreamStatus: response.status,
        upstreamContentType: contentType || null,
        preview: text.slice(0, 240),
      }, 502);
    }

    return new Response(text, {
      status: response.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : 'Pages bridge failed',
    }, 500);
  }
};

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  return onRequestPost(context);
};
