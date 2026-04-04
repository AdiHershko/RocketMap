module.exports = async function handler(req, res) {
  try {
    const raw = req.query.path || '';
    const pathPart = Array.isArray(raw) ? raw.join('/') : raw;
    const { path: _, ...queryParams } = req.query;
    const queryString = new URLSearchParams(queryParams).toString();
    const targetUrl = `https://www.oref.org.il/${pathPart}${queryString ? '?' + queryString : ''}`;

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
  } catch (err) {
    res.status(500).json({ error: String(err), stack: err.stack });
  }
};
