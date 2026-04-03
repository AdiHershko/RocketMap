export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname.replace('/api/nominatim', '');

  const response = await fetch(`https://nominatim.openstreetmap.org${path}${url.search}`, {
    headers: {
      'User-Agent': 'RocketMap/1.0 (israel-alert-map)',
      'Accept-Language': 'he',
    },
  });

  const body = await response.text();

  return new Response(body, {
    status: response.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=86400', // cache polygon responses for 24h
    },
  });
}
