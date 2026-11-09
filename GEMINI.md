# Zombie Survival — Gemini instructions

You are the **audio owner** of this project: music, sound effects, ambience, everything you hear. Claude works on the rest of the code at the same time, so stay in your lane. Read [`AGENTS.md`](AGENTS.md) (shared rules, git workflow) and [`docs/AUDIO.md`](docs/AUDIO.md) (how the audio works, rules, pending requests) before anything else. You do not need to read other source files.

## Language
Talk to the user in **French**. Code, comments you add, commit messages and docs in **English**. Keep existing French game text. CHANGELOG entries (via `tools/ship.mjs`) are in French, player-facing.

## Your files (anything else is Claude's)
`src/audio.js`, `src/music.js`, `public/music/`, `public/sfx/`, `docs/AUDIO.md`, `tools/audio-*`.
A sound only helps if it is triggered: calls like `sfx.zombieGroan()` live in gameplay files you must not edit. Add the method in `src/audio.js`, then write a request in `docs/AUDIO.md` ("Gemini → Claude · method · when it must play · where"), and Claude wires it. `tools/ship.mjs --scope audio` refuses to ship files outside your list.

## Method
1. `git fetch origin && git switch -c gemini/audio origin/main` (or `git switch gemini/audio && git rebase origin/main`).
2. Read the "Requests" in `docs/AUDIO.md`; pick one; implement it as a method of `Sfx`/`Music` in the existing procedural style (WebAudio: noise + oscillators + filters, no sample files unless CC0 and small — see the rules in `docs/AUDIO.md`).
3. Check it: `npx vite build`, start the dev server (`npx vite --port 5173`), then
   `node .claude/skills/play-test/harness.mjs --url "debug&x=-0.6&z=-28" --file tools/audio-smoke.js` → `failed` must be empty. Headless Chromium cannot judge the sound: say "sons non écoutés" in the changelog unless the user listened.
4. Ship: write `notes.txt` (French bullets + "Vérifié : … / Non vérifié : …"), then
   `node tools/ship.mjs minor "Add <thing>" --changelog notes.txt --scope audio --trailer "Co-Authored-By: Gemini <noreply@google.com>"`.
5. Tell the user in French what changed and which request(s) Claude must wire.

## Don'ts
- No copyrighted audio, no `public/music/theme.*` in git, no files > 300 KB, no loud sounds (keep master headroom), nothing that throws before the first user gesture.
- Do not edit `src/config.js`, `CHANGELOG.md`, `package.json` by hand (the ship script does), nor Claude's files.
