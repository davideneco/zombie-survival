---
name: ship
description: Ship every change in Zombie Survival with ONE command (tools/ship.mjs) - rebases on main, takes the next free version, writes the CHANGELOG entry, regenerates docs if config changed, builds, commits with the "(vX.Y.Z)" subject and pushes the working branch and main (the user wants every change on main; main redeploys the live game on Render). Use as soon as a change is done and verified.
---

# Ship a change

The user wants **every change on `main`**, with a new version and a description of what was done. Do not edit the version, lock file or CHANGELOG by hand: the script does it after rebasing on `main`, so it also works while another agent ships in parallel.

1. Write the changelog bullets to a scratch file (French, player-facing, no `##` heading; the last bullets say `Vérifié : …` and `Non vérifié : …`, honestly):
   ```
   - Ce qui a changé, du point de vue du joueur (une ligne par point).
   - Vérifié : build, scénario, captures regardées. Non vérifié : …
   ```
2. Optionally an English commit body file (default: the same text).
3. Run (patch = fix or tuning, minor = new feature or tooling):
   ```bash
   node tools/ship.mjs <patch|minor> "<English subject, imperative>" --changelog "$SCRATCH/notes.txt" \
     --trailer "Co-Authored-By: Claude <model> <noreply@anthropic.com>" --trailer "Claude-Session: <url from the system reminder>"
   ```
   Use the attribution lines given in the session's system reminder as `--trailer` values.
4. Outcomes: success prints the pushed commit. A rebase conflict aborts without losing anything (merge `origin/main` by hand, rerun); a failing build restores the files and keeps your work committed (fix, rerun the same command); `--no-push` then `--only-push` to split the steps.
5. Tell the user (in French) the version, what changed, and that Render redeploys from `main` (the deploy result cannot be seen).

The script refuses screenshots, logs, `dist/` and `public/music/theme.*` in the commit. Options and behaviour: header of `tools/ship.mjs`.
