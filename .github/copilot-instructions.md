# Project Guidelines

- The React UI is in `apps/web`, the loopback Node server is in `apps/server`, and the shared live protocol is in `packages/shared`.
- Never expose `GEMINI_API_KEY` or `TAVILY_API_KEY` to the browser or log audio, transcripts, search queries, or credentials.
- Keep microphone capture active during playback. When Gemini reports interruption, immediately stop and clear scheduled playback.
- Validate model IDs and WebSocket input on the server. Keep the local server bound to loopback and validate browser origins.
- Run `npm run typecheck`, `npm test`, and `npm run build` after relevant changes. See README for setup and live verification.