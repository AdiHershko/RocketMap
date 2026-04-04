module.exports = async function handler(req, res) {
  const pathSegments = req.query.path || [];
  const { path: _, ...queryParams } = req.query;
  const queryString = new URLSearchParams(queryParams).toString();
  const targetUrl = `https://nominatim.openstreetmap.org/${pathSegments.join('/')}${queryString ? '?' + queryString : ''}`;

  const response = await fetch(targetUrl, {
    headers: {
      'User-Agent': 'RocketMap/1.0 (israel-alert-map)',
      'Accept-Language': 'he',
    },
  });

  const body = await response.text();

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.status(response.status).send(body);
};
