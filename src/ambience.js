import { CONFIG } from './config.js';

// =====================================================================
//  Ambience mixer : decides which background sound plays where, local only (nothing is networked).
//    - the train ride of the intro : neither (the train sound is the ambience) ;
//    - standing in the station (world.gare.inArea) : the station loop, zone by zone (Quais / Hall / Place de la Gare) ;
//    - anywhere else : the city loop (wind, crickets, far dogs, far bells at the game hours), by zone and by night level.
//  The loops (Sfx.createCityAmbience / createStationAmbience) cross-fade through their zone argument. A loop's graph is built when first
//  needed and torn down CONFIG.audio.mix.fade + 1 s after it went silent, so an unused loop costs nothing. game.ambienceFrame(dt) is
//  called every frame by main.js, it works every CONFIG.audio.mix.period s.
// =====================================================================
export function installAmbience(game, { world, sfx }) {
  const M = CONFIG.audio.mix;
  const make = (factory) => ({ factory, loop: null, idle: 0, tries: 0 });
  const city = make(() => sfx.createCityAmbience?.()), station = make(() => sfx.createStationAmbience?.());
  let acc = 0;

  // want : true while the loop should be heard ; returns the loop to update (null when none is running)
  const drive = (S, want) => {
    if (want) {
      S.idle = 0;
      if (!S.loop && S.tries < 3) { S.tries++; S.loop = S.factory(); if (S.loop) S.loop.start(); } // (no AudioContext yet : try again a few times)
      if (S.loop && !S.loop.running) S.loop.start();
      return S.loop;
    }
    if (!S.loop) { S.tries = 0; return null; }
    if (!S.idle) S.idle = performance.now(); // (wall clock : the fade runs on the audio clock, whatever the frame rate)
    if (performance.now() - S.idle > (M.fade + 1) * 1000) { S.loop.stop(); S.loop = null; S.tries = 0; return null; }
    return S.loop; // (still fading out)
  };

  game.ambienceFrame = (dt) => {
    acc += dt;
    if (acc < M.period) return;
    acc = 0;
    const p = game.player, I = game.intro, fx = game.summitFx;
    const inGame = !!(game.started && !game.over && p);
    const ride = !!(I && I.on && I.ph === 'ride');
    const gare = world.gare;
    const inStation = inGame && !ride && !!gare && gare.inArea(p.pos.x, p.pos.z);
    const night = fx ? 1 - Math.min(1, Math.max(0, fx.skyK)) : 0.7;
    const mul = sfx.mood?.muffled ? M.pausedMul : 1; // paused (solo) : the ambience drops
    const wantCity = inGame && !ride && !inStation;
    const c = drive(city, wantCity);
    if (c) {
      const zi = wantCity && world.zoneOf ? world.zoneOf(p.pos.x, p.pos.z) : 100; // (no zone, e.g. Krutenau : default level)
      c.update(night, wantCity ? (zi < 0 ? 100 : zi) : -1, wantCity && fx ? fx.hour : -1, mul);
    }
    const s = drive(station, inStation);
    if (s) s.update(inStation ? gare.zoneName(p.pos.x, p.pos.z) : null, night, mul);
  };
  game.ambienceDebug = { city, station }; // tests : the running loops
}
