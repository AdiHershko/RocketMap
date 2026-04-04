export default async function handler(req, res) {
  const path = req.url.replace('/api/oref', '');

  const response = await fetch(`https://www.oref.org.il${path}`, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Referer: 'https://www.oref.org.il/',
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json',
    },
  });

  const body = await response.text();

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(response.status).send(body);
}
