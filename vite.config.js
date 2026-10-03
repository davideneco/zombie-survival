import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { attachMultiplayer } from './server/rooms.mjs';

// Version affichée en jeu : numéro du package + commit git + date du build.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
let commit = 'local';
try { commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
const GAME_VERSION = `v${pkg.version} · ${commit} · ${new Date().toISOString().slice(0, 10)}`;

// Le relais multijoueur (WebSocket /mp) tourne sur le même port que le jeu.
const multiplayer = () => ({
  name: 'zombie-multiplayer',
  configureServer(server) { attachMultiplayer(server.httpServer); },
  configurePreviewServer(server) { attachMultiplayer(server.httpServer); },
});

export default {
  define: { __GAME_VERSION__: JSON.stringify(GAME_VERSION) },
  build: { target: "esnext" },
  esbuild: { target: "esnext" },
  optimizeDeps: { esbuildOptions: { target: "esnext" } },
  plugins: [multiplayer()],
};
