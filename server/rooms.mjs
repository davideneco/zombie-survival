// Relais multijoueur : salons à code de 4 lettres, 4 joueurs max.
// Le serveur ne simule rien : le premier joueur (hôte) fait tourner le jeu, le serveur relaie les messages.
import { WebSocketServer } from 'ws';
import { CONFIG } from '../src/config.js';
import { cleanChat } from '../src/chatText.js';

const MAX_PLAYERS = 4;
const CHAR_COUNT = 8; // personnages jouables (src/characters.js)
const rooms = new Map();
let nextId = 1;

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)];
    if (!rooms.has(c)) return c;
  }
}

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const peersOf = (room) => [...room.members.values()].map((m) => ({ id: m.id, name: m.name, slot: m.slot }));
// Plus petit emplacement (0-3) libre : détermine la couleur / le skin du joueur, identique pour tout le monde.
const freeSlot = (room, want = -1) => {
  const used = new Set([...room.members.values()].map((m) => m.slot));
  if (Number.isInteger(want) && want >= 0 && want < CHAR_COUNT && !used.has(want)) return want; // personnage demandé s'il est libre
  for (let i = 0; i < CHAR_COUNT; i++) if (!used.has(i)) return i;
  return 0;
};

// ---- Chat écrit : le relais ne fait pas confiance au client (texte, taille, débit). Le nom affiché est celui du membre dans le salon.
const CHAT = CONFIG.chat;
const cleanText = (t) => cleanChat(t, CHAT.maxLen);
// Débit : rateCount messages par rateWindow secondes et par joueur ; faux = excédent, à ignorer
function chatAllowed(ws, now) {
  const times = ws.chatTimes || (ws.chatTimes = []);
  while (times.length && now - times[0] >= CHAT.rateWindow * 1000) times.shift();
  if (times.length >= CHAT.rateCount) return false;
  times.push(now);
  return true;
}

function leave(ws) {
  const room = rooms.get(ws.room);
  if (!room) return;
  room.members.delete(ws.pid);
  if (room.host === ws.pid) {
    for (const m of room.members.values()) { send(m.ws, { t: 'closed' }); m.ws.room = null; }
    rooms.delete(ws.room);
  } else {
    for (const m of room.members.values()) send(m.ws, { t: 'left', id: ws.pid });
  }
  ws.room = null;
}

function onMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg !== 'object') return; // `null`, un nombre… : rien à lire
  const name = String(msg.name || 'Joueur').slice(0, 12);

  if (msg.t === 'create') {
    if (ws.room) leave(ws);
    const code = makeCode();
    const room = { code, host: ws.pid, started: false, members: new Map() };
    const slot0 = freeSlot(room, msg.slot);
    room.members.set(ws.pid, { id: ws.pid, name, ws, slot: slot0 });
    rooms.set(code, room);
    ws.room = code;
    send(ws, { t: 'joined', id: ws.pid, slot: slot0, code, host: ws.pid, started: false, peers: peersOf(room) });
    return;
  }

  if (msg.t === 'join') {
    if (ws.room) leave(ws);
    const code = String(msg.code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return send(ws, { t: 'error', msg: 'Salon introuvable.' });
    if (room.members.size >= MAX_PLAYERS) return send(ws, { t: 'error', msg: 'Salon complet (4 joueurs max).' });
    const slot = freeSlot(room, msg.slot);
    room.members.set(ws.pid, { id: ws.pid, name, ws, slot });
    ws.room = code;
    send(ws, { t: 'joined', id: ws.pid, slot, code, host: room.host, started: room.started, peers: peersOf(room) });
    for (const m of room.members.values()) if (m.id !== ws.pid) send(m.ws, { t: 'peer', id: ws.pid, name, slot });
    return;
  }

  // Tout le reste est relayé : msg.to = id précis, sinon tous les autres membres.
  const room = rooms.get(ws.room);
  if (!room) return;
  // chat : diffusé à TOUS les membres, expéditeur compris (le client n'affiche rien en local : pas de doublon) ; jamais d'envoi ciblé
  if (msg.t === 'chat') {
    const text = cleanText(msg.text);
    if (!text) return;
    if (!chatAllowed(ws, Date.now())) return send(ws, { t: 'chat_lim', from: 0 });
    const out = { t: 'chat', from: ws.pid, text };
    for (const m of room.members.values()) send(m.ws, out);
    return;
  }
  // menu debug : seul l'hôte peut envoyer dbg_tp / dbg_note (dbg_ack est la réponse d'un client à l'hôte)
  if (typeof msg.t === 'string' && msg.t.startsWith('dbg_') && msg.t !== 'dbg_ack' && room.host !== ws.pid) return;
  if (msg.t === 'start' && room.host === ws.pid) room.started = true;
  msg.from = ws.pid;
  if (msg.to != null && msg.to !== '*') {
    const toId = Number(msg.to);
    const m = room.members.get(toId) || room.members.get(msg.to);
    if (m) send(m.ws, msg);
  } else {
    for (const m of room.members.values()) if (m.id !== ws.pid) send(m.ws, msg);
  }
}

// Attache le relais sur le chemin /mp d'un serveur HTTP existant (Vite dev ou preview).
export function attachMultiplayer(httpServer) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: CONFIG.chat.maxNet }); // un message plus gros ferme la connexion (aucun message de jeu n'approche 1 Mo)
  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith('/mp')) return; // laisse passer le HMR de Vite
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws) => {
    ws.pid = nextId++;
    ws.room = null;
    ws.on('message', (raw) => onMessage(ws, raw.toString()));
    ws.on('close', () => leave(ws));
    ws.on('error', () => {});
  });
}
