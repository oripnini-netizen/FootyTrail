// Serverless function (Vercel) that proxies a remote image through your own origin
// URL: /api/proxy-image?src=<FULL_IMAGE_URL>

export default async function handler(req, res) {
  try {
    const { src } = req.query || {};
    if (!src) {
      res.status(400).send('Missing ?src=');
      return;
    }

    let url;
    try {
      url = new URL(src);
    } catch {
      res.status(400).send('Invalid src URL');
      return;
    }

    // Optional safety: only allow http/https
    if (!/^https?:$/.test(url.protocol)) {
      res.status(400).send('Unsupported protocol');
      return;
    }

    // Optional: whitelist hosts to avoid open-proxy abuse
    // const allowedHosts = ['tmssl.akamaized.net', 'transfermarkt.com', 'upload.wikimedia.org'];
    // if (!allowedHosts.includes(url.hostname)) {
    //   res.status(403).send('Host not allowed');
    //   return;
    // }

    const upstream = await fetch(url.toString(), {
      headers: { 'User-Agent': 'footytrail-proxy' },
    });

    if (!upstream.ok) {
      res.status(upstream.status).send('Upstream error');
      return;
    }

    // CORS + caching + content type
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');

    // Send body (compatible across runtimes)
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).send('proxy error');
  }
}
