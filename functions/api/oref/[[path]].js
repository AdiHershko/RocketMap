const ALERTS_PATH  = '/WarningMessages/alert/alerts.json';
const CACHE_KEY    = 'https://oref-internal.cache/recent-alert';
const CACHE_TTL_S  = 300; // 5 minutes

export async function onRequest(context) {
  const url  = new URL(context.request.url);
  const path = url.pathname.replace('/api/oref', '');

  // Custom endpoint: return the last alert we cached from a live poll
  if (path === '/recent-alert') {
    const cached = await caches.default.match(new Request(CACHE_KEY));
    if (!cached) return new Response('null', { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    const body = await cached.text();
    return new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }

  const response = await fetch(`https://www.oref.org.il${path}${url.search}`, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Referer: 'https://www.oref.org.il/',
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json',
    },
  });

  const body = await response.text();

  // Whenever a live poll returns active alerts, cache them
  if (path === ALERTS_PATH) {
    const trimmed = body.trim().replace(/^\uFEFF/, '');
    if (trimmed) {
      try {
        const data = JSON.parse(trimmed);
        if (data?.data?.length > 0) {
          const payload = JSON.stringify({ ...data, _cachedAt: Date.now() });
          context.waitUntil(
            caches.default.put(
              new Request(CACHE_KEY),
              new Response(payload, {
                headers: {
                  'Content-Type': 'application/json',
                  'Cache-Control': `max-age=${CACHE_TTL_S}`,
                },
              })
            )
          );
        }
      } catch {}
    }
  }

  return new Response(body, {
    status: response.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
