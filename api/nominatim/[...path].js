export default async function handler(req, res) {
  const path = req.url.replace('/api/nominatim', '');

  const response = await fetch(`https://nominatim.openstreetmap.org${path}`, {
    headers: {
      'User-Agent': 'RocketMap/1.0 (israel-alert-map)',
      'Accept-Language': 'he',
    },
  });

  const body = await response.text();

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.status(response.status).send(body);
}
