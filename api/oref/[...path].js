export default async function handler(req, res) {
  const pathSegments = req.query.path || [];
  const { path: _, ...queryParams } = req.query;
  const queryString = new URLSearchParams(queryParams).toString();
  const targetUrl = `https://www.oref.org.il/${pathSegments.join('/')}${queryString ? '?' + queryString : ''}`;

  const response = await fetch(targetUrl, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Referer: 'https://www.oref.org.il/',
      Origin: 'https://www.oref.org.il',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });

  const body = await response.text();

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(response.status).send(body);
}
