module.exports = async function handler(req, res) {
  const pathSegments = req.query.path || [];
  const { path: _, ...queryParams } = req.query;
  const queryString = new URLSearchParams(queryParams).toString();
  const targetUrl = `https://www.oref.org.il/${pathSegments.join('/')}${queryString ? '?' + queryString : ''}`;

  const response = await fetch(targetUrl, {
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
};
