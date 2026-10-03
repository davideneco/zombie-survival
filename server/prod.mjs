// Serveur de production Node.js pour Render.com
// Sert le dossier dist/ (fichiers statiques Three.js) et héberge le relais WebSocket (/mp) sur le même port.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { attachMultiplayer } from './rooms.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, '../dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  // Ignorer les requêtes non-GET/HEAD
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end('Method Not Allowed');
  }

  // Nettoyage de l'URL
  let reqPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

  let filePath = path.join(DIST_DIR, reqPath);

  // Sécurité : éviter de sortir de DIST_DIR
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  // Si le fichier n'existe pas, renvoie index.html (SPA fallback)
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const stat = fs.statSync(filePath);
    const headers = {
      'Content-Type': contentType,
      'Content-Length': stat.size,
    };

    // Cache long pour les assets hashés par Vite, no-cache pour index.html
    if (reqPath.startsWith('/assets/')) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    } else {
      headers['Cache-Control'] = 'no-cache';
    }

    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    res.writeHead(500);
    res.end('Internal Server Error: ' + err.message);
  }
});

// Attache le relais multijoueur sur /mp
attachMultiplayer(server);

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`[Zombie Survival] Serveur démarré sur http://${HOST}:${PORT}`);
  console.log(`[Zombie Survival] WebSocket relais actif sur /mp`);
});
