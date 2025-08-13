const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:3000',
      changeOrigin: true,
      pathRewrite: {
        '^/api': '/api', // no rewrite needed, but keeping for clarity
      },
      onProxyReq: (proxyReq, req, res) => {
        console.log('Proxying request:', req.method, req.path);
      },
      onProxyRes: (proxyRes, req, res) => {
        console.log('Received proxy response:', proxyRes.statusCode);
      },
      onError: (err, req, res) => {
        console.error('Proxy error:', err);
      },
    })
  );
};