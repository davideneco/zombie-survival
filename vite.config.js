import { attachMultiplayer } from './server/rooms.mjs';

// Le relais multijoueur (WebSocket /mp) tourne sur le même port que le jeu.
const multiplayer = () => ({
  name: 'zombie-multiplayer',
  configureServer(server) { attachMultiplayer(server.httpServer); },
  configurePreviewServer(server) { attachMultiplayer(server.httpServer); },
});

export default {
  build: { target: "esnext" },
  esbuild: { target: "esnext" },
  optimizeDeps: { esbuildOptions: { target: "esnext" } },
  plugins: [multiplayer()],
};
