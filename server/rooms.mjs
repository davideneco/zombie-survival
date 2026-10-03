// Relais multijoueur : salons à code de 4 lettres, 4 joueurs max.
// Le serveur ne simule rien : le premier joueur (hôte) fait tourner le jeu, le serveur relaie les messages.
import { WebSocketServer } from 'ws';

const MAX_PLAYERS = 4;
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
const peersOf = (room) => [...room.members.values()].map((m) => ({ id: m.id, name: m.name }));

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
  const name = String(msg.name || 'Joueur').slice(0, 12);

  if (msg.t === 'create') {
    if (ws.room) leave(ws);
    const code = makeCode();
    const room = { code, host: ws.pid, started: false, members: new Map() };
    room.members.set(ws.pid, { id: ws.pid, name, ws });
    rooms.set(code, room);
    ws.room = code;
    send(ws, { t: 'joined', id: ws.pid, code, host: ws.pid, started: false, peers: peersOf(room) });
    return;
  }

  if (msg.t === 'join') {
    if (ws.room) leave(ws);
    const code = String(msg.code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return send(ws, { t: 'error', msg: 'Salon introuvable.' });
    if (room.members.size >= MAX_PLAYERS) return send(ws, { t: 'error', msg: 'Salon complet (4 joueurs max).' });
    room.members.set(ws.pid, { id: ws.pid, name, ws });
    ws.room = code;
    send(ws, { t: 'joined', id: ws.pid, code, host: room.host, started: room.started, peers: peersOf(room) });
    for (const m of room.members.values()) if (m.id !== ws.pid) send(m.ws, { t: 'peer', id: ws.pid, name });
    return;
  }

  // Tout le reste est relayé : msg.to = id précis, sinon tous les autres membres.
  const room = rooms.get(ws.room);
  if (!room) return;
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
  const wss = new WebSocketServer({ noServer: true });
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
