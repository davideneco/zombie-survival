---
name: ship
description: Ship a game change in Zombie Survival - bump the version in package.json, regenerate the generated docs, build, commit with the "(vX.Y.Z)" subject convention and push to the working branch. Pushing to main (live deploy on Render) only with explicit user confirmation. Use when a change is done and verified.
---

# Ship a change

1. **Version**: bump `package.json` `version` (patch for fixes and tuning, minor for new features). One bump per shipped change.
2. **Docs**: if `src/config.js` changed, run `node tools/make-docs.mjs` (regenerates `docs/REFERENCE.md` and `docs/csv/`). Never edit those by hand.
3. **Build**: `npx vite build` must pass.
4. **Check the diff**: `git status` and `git diff --stat`; no screenshots, test scripts, `dist/`, logs or copyrighted music (`public/music/theme.*`).
5. **Commit**: English subject in the imperative, ending with the version, e.g. `Add sloping river banks (v0.74.0)`. Body: what changed and what was or was not verified.
6. **Push** to the current working branch: `git push -u origin <branch>` (on network failure retry with backoff 2s, 4s, 8s, 16s).
7. **main**: only when the user explicitly asks in this conversation. `main` deploys the live game on Render. If the branch is ahead of `main` with no divergence: `git push origin HEAD:main` (fast-forward). Otherwise merge `origin/main` into the branch first, rebuild, then push. Tell the user Render will redeploy and that you cannot see the deploy result.
