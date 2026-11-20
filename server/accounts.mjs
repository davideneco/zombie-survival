// Hybrid server-side account API (/api/account/*) — zero external dependencies (Node crypto + fs).
// Works in dev/preview (vite.config.js middleware) and production (server/prod.mjs on Render).
// Storage: DATA_DIR/accounts.json (defaults to .data/accounts.json). On Render free tier without a
// persistent disk, clients automatically mirror their profile in localStorage and can restore/re-sync.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.env.DATA_DIR || '.data');
const DB_FILE = path.join(DATA_DIR, 'accounts.json');
const SECRET_FILE = path.join(DATA_DIR, 'auth.secret');
const MAX_BODY = 32 * 1024;
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days

function ensureDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}

function loadSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  ensureDir();
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const s = fs.readFileSync(SECRET_FILE, 'utf8').trim();
      if (s.length >= 32) return s;
    }
  } catch {}
  const fresh = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(SECRET_FILE, fresh, { mode: 0o600 }); } catch {}
  return fresh;
}

const AUTH_SECRET = loadSecret();

let store = { users: {} };
try {
  if (fs.existsSync(DB_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (raw && typeof raw.users === 'object') store = raw;
  }
} catch (err) {
  console.warn('[accounts] Failed to load DB, starting fresh:', err.message);
}

function saveStore() {
  ensureDir();
  const tmp = DB_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    console.warn('[accounts] Failed to persist DB:', err.message);
  }
}

const clampInt = (v, min = 0, max = 1e9) => {
  const n = Math.floor(Number(v) || 0);
  return Math.max(min, Math.min(max, n));
};

function sanitizeUsername(raw) {
  const name = String(raw || '').trim().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > 16) return null;
  if (!/^[a-zA-Z0-9À-ÿ _-]+$/.test(name)) return null;
  return name;
}

const userKey = (name) => name.toLowerCase();

function defaultStats() {
  return {
    xp: 0,
    kills: 0,
    headshots: 0,
    revives: 0,
    games: 0,
    victories: 0,
    bestRound: 0,
    bestPoints: 0,
    timePlayed: 0,
  };
}

function sanitizeStats(raw) {
  const s = defaultStats();
  if (!raw || typeof raw !== 'object') return s;
  s.xp = clampInt(raw.xp, 0, 5e7);
  s.kills = clampInt(raw.kills, 0, 1e7);
  s.headshots = clampInt(raw.headshots, 0, s.kills);
  s.revives = clampInt(raw.revives, 0, 1e6);
  s.games = clampInt(raw.games, 0, 1e6);
  s.victories = clampInt(raw.victories, 0, s.games);
  s.bestRound = clampInt(raw.bestRound, 0, 999);
  s.bestPoints = clampInt(raw.bestPoints, 0, 1e9);
  s.timePlayed = clampInt(raw.timePlayed, 0, 1e8);
  return s;
}

function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const m of raw.slice(0, 12)) {
    if (!m || typeof m !== 'object') continue;
    out.push({
      id: String(m.id || '').slice(0, 32),
      date: String(m.date || '').slice(0, 24),
      mode: m.mode === 'coop' ? 'coop' : 'solo',
      round: clampInt(m.round, 0, 999),
      kills: clampInt(m.kills, 0, 1e5),
      headshots: clampInt(m.headshots, 0, 1e5),
      points: clampInt(m.points, 0, 1e8),
      xpGained: clampInt(m.xpGained, 0, 1e6),
      victory: Boolean(m.victory),
      duration: clampInt(m.duration, 0, 86400),
    });
  }
  return out.slice(0, 8);
}

// Monotonic merge so hybrid offline/local progress is never lost on sync or server restart
function mergeProfile(base, incoming) {
  const a = sanitizeStats(base?.stats);
  const b = sanitizeStats(incoming?.stats);
  const stats = {
    xp: Math.max(a.xp, b.xp),
    kills: Math.max(a.kills, b.kills),
    headshots: Math.max(a.headshots, b.headshots),
    revives: Math.max(a.revives, b.revives),
    games: Math.max(a.games, b.games),
    victories: Math.max(a.victories, b.victories),
    bestRound: Math.max(a.bestRound, b.bestRound),
    bestPoints: Math.max(a.bestPoints, b.bestPoints),
    timePlayed: Math.max(a.timePlayed, b.timePlayed),
  };
  stats.headshots = Math.min(stats.headshots, stats.kills);
  stats.victories = Math.min(stats.victories, stats.games);

  const histMap = new Map();
  for (const item of [...sanitizeHistory(base?.history), ...sanitizeHistory(incoming?.history)]) {
    const k = item.id || `${item.date}-${item.round}-${item.kills}`;
    if (!histMap.has(k)) histMap.set(k, item);
  }
  const history = [...histMap.values()]
    .sort((x, y) => String(y.date).localeCompare(String(x.date)))
    .slice(0, 8);

  const charPref = incoming?.charPref != null ? clampInt(incoming.charPref, 0, 16) : clampInt(base?.charPref, 0, 16);
  return { stats, history, charPref };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 32).toString('hex');
  return { salt, hash: derived };
}

function verifyPassword(password, salt, hash) {
  const derived = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function signToken(key) {
  const payload = Buffer.from(JSON.stringify({ u: key, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data?.u || data.exp < Date.now()) return null;
    return data.u;
  } catch {
    return null;
  }
}

function publicUser(u) {
  return {
    username: u.username,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    charPref: u.charPref || 0,
    stats: u.stats,
    history: u.history || [],
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function getBearer(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
}

// Handles /api/account/* requests. Returns true if handled, false otherwise.
export function handleAccountRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/account/')) return false;

  const route = url.pathname.slice('/api/account/'.length);

  (async () => {
    try {
      if (route === 'register' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const username = sanitizeUsername(body.username);
        const password = String(body.password || '');
        if (!username) return sendJson(res, 400, { error: 'Pseudo invalide (3 à 16 caractères : lettres, chiffres, espaces, - ou _).' });
        if (password.length < 4 || password.length > 64) return sendJson(res, 400, { error: 'Le mot de passe doit contenir au moins 4 caractères.' });
        const key = userKey(username);
        if (store.users[key]) return sendJson(res, 409, { error: 'Ce pseudo est déjà utilisé.' });

        const { salt, hash } = hashPassword(password);
        const merged = mergeProfile({ stats: defaultStats(), history: [], charPref: 0 }, body.profile || {});
        const now = new Date().toISOString();
        const user = {
          username,
          salt,
          hash,
          createdAt: now,
          updatedAt: now,
          ...merged,
        };
        store.users[key] = user;
        saveStore();
        return sendJson(res, 201, { token: signToken(key), user: publicUser(user) });
      }

      if (route === 'login' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const username = sanitizeUsername(body.username);
        const password = String(body.password || '');
        if (!username || !password) return sendJson(res, 400, { error: 'Veuillez renseigner un pseudo et un mot de passe.' });
        const key = userKey(username);
        let user = store.users[key];
        if (!user) {
          // Hybrid recovery: if client explicitly indicates it holds a local mirror for this account (e.g. after ephemeral Render restart)
          if (body.restoreIfMissing && body.profile) {
            const { salt, hash } = hashPassword(password);
            const merged = mergeProfile({ stats: defaultStats(), history: [], charPref: 0 }, body.profile);
            const now = new Date().toISOString();
            user = { username, salt, hash, createdAt: now, updatedAt: now, ...merged };
            store.users[key] = user;
            saveStore();
            return sendJson(res, 200, { token: signToken(key), user: publicUser(user), restored: true });
          }
          return sendJson(res, 401, { error: 'Compte introuvable ou mot de passe incorrect.' });
        }
        if (!verifyPassword(password, user.salt, user.hash)) {
          return sendJson(res, 401, { error: 'Compte introuvable ou mot de passe incorrect.' });
        }
        // Merge any newer offline/local progress if provided
        if (body.profile) {
          const merged = mergeProfile(user, body.profile);
          user.stats = merged.stats;
          user.history = merged.history;
          user.charPref = merged.charPref;
          user.updatedAt = new Date().toISOString();
          saveStore();
        }
        return sendJson(res, 200, { token: signToken(key), user: publicUser(user) });
      }

      if (route === 'me' && req.method === 'GET') {
        const key = verifyToken(getBearer(req));
        const user = key ? store.users[key] : null;
        if (!user) return sendJson(res, 401, { error: 'Session expirée.' });
        return sendJson(res, 200, { user: publicUser(user) });
      }

      if (route === 'sync' && req.method === 'POST') {
        const key = verifyToken(getBearer(req));
        const user = key ? store.users[key] : null;
        if (!user) return sendJson(res, 401, { error: 'Session expirée.' });
        const body = await readJsonBody(req);
        const merged = mergeProfile(user, body);
        user.stats = merged.stats;
        user.history = merged.history;
        user.charPref = merged.charPref;
        user.updatedAt = new Date().toISOString();
        saveStore();
        return sendJson(res, 200, { user: publicUser(user) });
      }

      return sendJson(res, 404, { error: 'Endpoint inconnu.' });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || 'Requête invalide.' });
    }
  })();

  return true;
}
