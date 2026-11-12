---
name: live-voice-testing
description: 'Test and debug live voice sessions, microphone streaming, and interruption handling in Voice Studio.'
---

# Live Voice Testing

Use this workflow when changing microphone capture, playback, Gemini events, or session lifecycle.

1. Run `npm run typecheck`, `npm test`, and `npm run build`.
2. Start the application using the setup in README. Use a valid Gemini API key without exposing it in logs or chat.
3. Connect with microphone permission, speak a prompt, and confirm the transcript and audio response.
4. Interrupt a long response while it is playing. Confirm queued audio stops and the next spoken request receives a response.
5. Test mute, unmute, disconnect, denied permission, and provider errors. Check that the microphone stops after disconnect.
6. Check desktop and mobile layouts, keyboard access, and that transcripts are not persisted.

Live API usage may incur charges. Never record or log private audio or transcripts during testing.