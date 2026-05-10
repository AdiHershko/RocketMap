const ALLOWED_NOMINATIM_PATHS = new Set(['/search', '/reverse', '/lookup', '']);

module.exports = async function handler(req, res) {
  const raw = req.query.path || '';
  const pathPart = Array.isArray(raw) ? raw.join('/') : raw;
  const normalizedPath = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;

  if (!ALLOWED_NOMINATIM_PATHS.has(normalizedPath)) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  const { path: _, ...queryParams } = req.query;
  const queryString = new URLSearchParams(queryParams).toString();
  const targetUrl = `https://nominatim.openstreetmap.org${normalizedPath}${queryString ? '?' + queryString : ''}`;

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
