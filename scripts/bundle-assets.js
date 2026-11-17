const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const outFile = path.join(__dirname, '..', 'lib', 'static-assets.js');

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

const assets = {};

function walk(dir, prefix = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      walk(full, rel);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      const b64 = fs.readFileSync(full).toString('base64');
      assets[rel] = { mime, b64 };
    }
  }
}

walk(publicDir);

const code = `// Auto-generated static assets bundle for serverless environments\nconst ASSETS = ${JSON.stringify(assets, null, 2)};\nmodule.exports = ASSETS;\n`;
fs.writeFileSync(outFile, code);
console.log('Bundled assets:', Object.keys(assets));
