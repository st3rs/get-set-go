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
      return json({ ok: false, error: 'BROWSER_API service binding is not configured.' }, 503);
    }

    const body = await context.request.text();
    const upstream = await context.env.BROWSER_API.fetch(new Request('https://get-set-go-api.internal/jobs', {
      method: 'POST',
      headers: { 'content-type': context.request.headers.get('content-type') || 'application/json' },
      body,
    }));

    const text = await upstream.text();
    const contentType = upstream.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return json({ ok: false, error: 'Background job service returned a non-JSON response.', upstreamStatus: upstream.status }, 502);
    }

    return new Response(text, {
      status: upstream.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'Could not create reconstruction job' }, 500);
  }
};

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  return onRequestPost(context);
};
