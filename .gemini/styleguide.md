# Review guide (Gemini Code Assist)

Follow `AGENTS.md` and `GEMINI.md` at the repository root.
- Pull requests from `gemini/*` branches may only touch the audio files listed in `tools/scopes.json` (`audio`); flag anything else.
- Flag copyrighted audio, files over 300 KB, `public/music/theme.*`, screenshots, logs or `dist/` in a diff.
- Sounds must not throw before the first user gesture and must not clip the master gain.
- Game text stays French; code, comments and commit messages are English.
