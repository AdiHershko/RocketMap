export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname.replace('/api/oref', '');

  const response = await fetch(`https://www.oref.org.il${path}${url.search}`, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Referer: 'https://www.oref.org.il/',
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json',
    },
  });

  const body = await response.text();

  return new Response(body, {
    status: response.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
