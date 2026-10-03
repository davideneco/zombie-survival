// Client réseau : mince enveloppe autour du WebSocket vers le relais (/mp).
export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.hostId = null;
    this.handlers = {};
  }

  get isHost() { return this.id != null && this.id === this.hostId; }
  get connected() { return !!this.ws && this.ws.readyState === 1; }

  on(type, fn) { this.handlers[type] = fn; }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/mp`);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Connexion au serveur impossible.'));
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        const h = this.handlers[m.t];
        if (h) h(m);
      };
      ws.onclose = () => { const h = this.handlers.disconnect; if (h) h(); };
    });
  }

  // to : id d'un joueur, ou omis pour tous les autres
  send(msg, to) {
    if (!this.connected) return;
    if (to != null) msg.to = to;
    this.ws.send(JSON.stringify(msg));
  }

  close() { if (this.ws) { this.ws.onclose = null; this.ws.close(); } this.ws = null; }
}
