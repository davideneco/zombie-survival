---
name: ship
description: Ship every change in Zombie Survival - bump the version in package.json, add a CHANGELOG.md entry describing what was done, regenerate the generated docs, build, commit with the "(vX.Y.Z)" subject convention, push the working branch and fast-forward main (the user asked for every change to go to main; main redeploys the live game on Render). Use as soon as a change is done and verified.
---

# Ship a change

The user wants **every change on `main`**, with a new version and a description of what was done.

1. **Version**: bump `package.json` `version` (patch for fixes and tuning, minor for new features or tooling). One bump per shipped change.
2. **Changelog**: add an entry at the top of `CHANGELOG.md`:
   ```
   ## vX.Y.Z (YYYY-MM-DD)
   - Ce qui a changé, en français, du point de vue du joueur (une ligne par point).
   - Vérifié : build, scénario Playwright, captures regardées… / Non vérifié : …
   ```
3. **Docs**: if `src/config.js` changed, run `node tools/make-docs.mjs` (regenerates `docs/REFERENCE.md` and `docs/csv/`). Never edit those by hand.
4. **Build**: `npx vite build` must pass.
5. **Check the diff**: `git status` and `git diff --stat`; no screenshots, test scripts, `dist/`, logs or copyrighted music (`public/music/theme.*`).
6. **Commit**: English subject in the imperative, ending with the version, e.g. `Add sloping river banks (v0.74.0)`. Body: the same points as the changelog entry (what changed, what was and was not verified).
7. **Push the working branch**: `git push -u origin <branch>` (on network failure retry with backoff 2s, 4s, 8s, 16s).
8. **Push `main`**: `git fetch origin main`; if `origin/main` is an ancestor of `HEAD` (`git merge-base --is-ancestor origin/main HEAD`), `git push origin HEAD:main`. Otherwise merge `origin/main` into the branch, rebuild, push the branch, then push `HEAD:main`. Never force-push `main`.
9. Tell the user the version, what changed, and that Render redeploys from `main` (you cannot see the deploy result).
