const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const arribosHandler = require('./api/arribos');
const recorridoHandler = require('./api/recorrido');
const infoHandler = require('./api/info');
const staticAssets = require('./lib/static-assets');

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
  try {
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
  } catch (_) {
    return [];
  }
}

async function requestHandler(req, res) {
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const urlObj = new URL(req.url || '/', `http://${host}`);
    const pathname = urlObj.pathname;
    const apiParam = urlObj.searchParams.get('api');

    // 1. Rutas de la API (soportando tanto pathname directo como query ?api=... tras rewrites de Vercel)
    if (apiParam === 'arribos' || pathname.includes('/arribos')) {
      return await arribosHandler(req, res);
    }

    if (apiParam === 'recorrido' || pathname.includes('/recorrido')) {
      return await recorridoHandler(req, res);
    }

    if (apiParam === 'info' || pathname.includes('/info')) {
      if (process.env.VERCEL) {
        return infoHandler(req, res);
      }
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

    // 2. Normalizar ruta de archivo estático
    let assetKey = pathname === '/' ? '/index.html' : pathname;
    if (assetKey.startsWith('/public/')) {
      assetKey = assetKey.slice('/public'.length);
    }

    // 3.En local, intentar leer primero de /public por si se editó en caliente; en Vercel o fallback, usar bundle en memoria
    if (!process.env.VERCEL) {
      const safePath = path.normalize(assetKey).replace(/^(\.\.[/\\])+/, '');
      const filePath = path.join(PUBLIC_DIR, safePath);
      if (filePath.startsWith(PUBLIC_DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        res.statusCode = 200;
        res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
        if (ext === '.html' || safePath.endsWith('sw.js')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
        return res.end(fs.readFileSync(filePath));
      }
    }

    // 4. Servir desde el bundle estático en memoria (100% garantizado en Vercel Serverless)
    const asset = staticAssets[assetKey] || staticAssets['/index.html'];
    if (asset) {
      res.statusCode = 200;
      res.setHeader('Content-Type', asset.mime);
      if (assetKey.endsWith('.html') || assetKey.endsWith('sw.js') || assetKey === '/manifest.json') {
        res.setHeader('Cache-Control', 'no-cache');
      }
      return res.end(Buffer.from(asset.b64, 'base64'));
    }

    res.statusCode = 404;
    res.end('Not found');
  } catch (err) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

// Exportamos la función para que Vercel Serverless (@vercel/node) la invoque directamente sin fallar
module.exports = requestHandler;

// Solo iniciamos el puerto TCP cuando se ejecuta localmente en la PC
if (require.main === module && !process.env.VERCEL) {
  const server = http.createServer(requestHandler);
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
}
