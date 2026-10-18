// Port Godot (v0.17.0) : les cuissons (bake-world, bake-vehicles) chargent le jeu JS SANS les rames de décor de la place de l'Homme de Fer
// (CONFIG.tram.hdf.decor = []). Le jeu d'origine (src/) n'est pas touché : la réponse HTTP de /src/config.js est réécrite à la volée
// par le domaine Fetch du protocole Chrome. La rame conduisible (CONFIG.tram.car) est la seule rame du port.
// Usage : await installNoDecor(ws, call)   avant Page.navigate.
export async function installNoDecor(ws, call) {
  let patched = 0;
  ws.on('message', async (d) => {
    const m = JSON.parse(d);
    if (m.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = m.params;
    if (!/\/src\/config\.js(\?|$)/.test(request.url)) { await call('Fetch.continueRequest', { requestId }); return; }
    const r = await call('Fetch.getResponseBody', { requestId });
    let body = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body;
    const re = /(\bdecor:\s*)\[\{[^\n]*\}\](,)/;
    if (!re.test(body)) throw new Error('bake-nodecor : « decor: [...] » introuvable dans src/config.js (le format a changé ?)');
    body = body.replace(re, '$1[]$2');
    patched++;
    await call('Fetch.fulfillRequest', {
      requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }, { name: 'Cache-Control', value: 'no-store' }],
      body: Buffer.from(body, 'utf8').toString('base64'),
    });
  });
  await call('Network.enable');
  await call('Network.setCacheDisabled', { cacheDisabled: true });
  await call('Fetch.enable', { patterns: [{ urlPattern: '*/src/config.js*', requestStage: 'Response' }] });
  return () => patched;
}
// Contrôle à faire dans la page une fois le jeu chargé : plus aucune rame de décor
export const CHECK_NO_DECOR = `(async () => { const c = await import('/src/config.js'); const h = await import('/src/hommedefer.js'); return { decor: c.CONFIG.tram.hdf.decor.length, trams: (window.game.world.hdf?.trams || []).length }; })()`;
