# Voice Studio

A local voice conversation app using Gemini Live. Choose a Gemini model, start a session, and speak naturally. The assistant can be interrupted while it is speaking.

## Requirements

- Node.js 22.18 or newer (Node 24 LTS recommended) and npm.
- A Gemini API key with access to the selected Live model. Usage may incur charges.
- A Tavily API key for web search. Tavily currently offers 1,000 free search credits per month without a credit card.
- A browser with microphone and AudioWorklet support; use localhost or a secure context.

## Start

1. Run `npm install`.
2. Copy `.env.example` to `.env` if you do not already have `.env`.
3. Set `GEMINI_API_KEY` and `TAVILY_API_KEY` in `.env`. If you already have `.env`, add only the Tavily line and preserve your Gemini key.
4. Run `npm run dev`, then open the Vite URL printed in the terminal.
5. Choose a model, start a conversation, and allow microphone access.

The included development dependency supplies a project-local Node runtime for npm scripts. A modern system Node and npm are still recommended for installation.

If port 3001 is already occupied, set the `PORT` environment variable before running `npm run dev`; both the server and Vite proxy use it. Vite chooses another port if its preferred UI port is occupied.

## Models

The selector is limited to Gemini Live models whose current API pricing lists free input and output: Gemini 3.8 Live, Gemini 3.8 Live Extended Thinking, Gemini 3.1 Flash Live Preview, and Gemini 2.5 Flash Live Preview. The last two are legacy previews; access and availability can be limited. Free-tier quotas and account eligibility still apply.

## Voice instructions

Edit `apps/server/voice-agent.json` to change the agent's language, tone, speaking style, and other instructions. Set `voiceName` to a Gemini prebuilt voice such as `Kore`, `Puck`, or `Zephyr`; see Google's [voice options](https://aistudio.google.com/docs/speech-generation#prebuilt-voices) for more. Language and tone are natural-language guidance, not guaranteed constraints. Gemini selects the spoken language from the conversation and instructions.

The server reads the file each time a session starts. End the current session and start a new one to apply changes; there is no need to restart the server. Keep the file valid JSON. Missing or invalid settings produce an error when connecting.

## Web search

Tavily web search is enabled by default by `webSearch` in `apps/server/voice-agent.json`. Gemini 3.8 Live remains the voice model; it can call the server-side `web_search` function, which queries Tavily and returns short results to the same Live session. Set `webSearch` to `false` and start a new session to disable search. Search guidance, including privacy, source attribution, and treating pages as untrusted data, is in the same file. The agent can describe sources aloud, but this app does not display source links or search results. Without `TAVILY_API_KEY`, normal voice conversations still work; a search request receives an unavailable message.

Search queries derived from the conversation are sent to Tavily, not Google Search grounding. Tavily currently lists 1,000 free credits per month without a credit card; a basic search uses one credit. Usage beyond the free allowance is subject to Tavily's plan and billing. Search is limited to five calls per Live session, queries are length-limited, and only a few short HTTPS results are returned to Gemini. See [Tavily's quickstart and plan](https://docs.tavily.com/documentation/quickstart) and [Search API docs](https://docs.tavily.com/documentation/api-reference/endpoint/search) for current terms. Do not put sensitive information in search queries.

## Verify

Run `npm run typecheck`, `npm test`, and `npm run build`. For browser tests, install Chromium with `npx playwright install chromium` and run `npm run test:e2e`. To check a live connection, ask for a long answer, speak over it, and confirm the old audio stops and the agent responds to the new request. Test mute/unmute and ending the session. To check search, ask for a recent event and its source. Live testing requires a valid key and can incur API and search charges.

## Privacy and limitations

Both API keys are loaded by the local server and are not sent to the browser. Audio and transcripts are sent to Gemini while connected; search queries are sent to Tavily only when a search function is called. The app does not persist them. The server binds to loopback and accepts WebSocket requests only from local Vite origins. This is a local development application, not a production-ready public server: hosting it requires authentication, TLS, abuse protection, and a security review.

Gemini Live is a preview API. Availability, model access, billing, and session limits depend on your Google account. Sessions can expire or be disconnected by the provider; reconnecting starts a new conversation. Changing models also starts a new conversation. No automatic session resumption is implemented.