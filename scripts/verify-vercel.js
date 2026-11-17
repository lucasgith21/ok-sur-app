process.env.VERCEL = '1';
const handler = require('../server');

async function testRoute(url) {
  return new Promise((resolve) => {
    const req = {
      method: 'GET',
      url,
      headers: { host: 'ok-sur-app.vercel.app', 'x-forwarded-proto': 'https' }
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      end(body) {
        const len = Buffer.isBuffer(body) ? body.length : (body || '').length;
        console.log(`${url.padEnd(22)} -> HTTP ${this.statusCode} | ${this.headers['Content-Type']} | ${len} bytes`);
        resolve();
      }
    };
    handler(req, res);
  });
}

(async () => {
  for (const r of [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/manifest.json',
    '/sw.js',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon.svg',
    '/api/info',
    '/api/recorrido',
    '/api/arribos'
  ]) {
    await testRoute(r);
  }
})();
