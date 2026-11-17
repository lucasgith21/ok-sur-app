const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const arribosHandler = require('./api/arribos');
const recorridoHandler = require('./api/recorrido');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ name, address: iface.address });
      }
    }
  }
  return ips;
}

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;

    // Endpoints de la API
    if (pathname === '/api/arribos') {
      return await arribosHandler(req, res);
    }

    if (pathname === '/api/recorrido') {
      return await recorridoHandler(req, res);
    }

    if (pathname === '/api/info') {
      const ips = getLocalIpAddresses();
      const primaryIp = ips[0]?.address || 'localhost';
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(
        JSON.stringify({
          ok: true,
          port: PORT,
          ips,
          lanUrl: `http://${primaryIp}:${PORT}`
        })
      );
    }

    // Archivos estáticos de /public
    let safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    if (safePath === '/' || safePath === '\\') {
      safePath = '/index.html';
    }

    const filePath = path.join(PUBLIC_DIR, safePath);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.statusCode = 403;
      return res.end('Forbidden');
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.statusCode = 200;
      res.setHeader('Content-Type', contentType);
      if (ext === '.html' || safePath.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
      return fs.createReadStream(filePath).pipe(res);
    }

    // Fallback SPA a index.html
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return fs.createReadStream(indexPath).pipe(res);
    }

    res.statusCode = 404;
    res.end('No encontrado');
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIpAddresses();
  console.log('====================================================');
  console.log('🚌 OK SUR - Cuando Llega Transpuntano (PWA Android)');
  console.log(`👉 En esta PC:     http://localhost:${PORT}`);
  ips.forEach((ip) => {
    console.log(`📱 En tu Celular:  http://${ip.address}:${PORT} (${ip.name})`);
  });
  console.log('====================================================');
});
