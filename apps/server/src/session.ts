import WebSocket from 'ws';
import { FunctionResponseScheduling, type FunctionCall, type Session } from '@google/genai';
import { isModelId, type ServerMessage } from '../../../packages/shared/src/protocol';
import { connectGemini, describeGeminiDisconnect, mapGeminiMessage, VoiceInstructionsError } from './gemini';
import { searchTavily } from './search';

const MAX_PENDING_BYTES = 1024 * 1024;
const MAX_AUDIO_BASE64 = 48_000;
const MAX_SEARCH_CALLS_PER_SESSION = 5;

export function attachSession(socket: WebSocket, apiKey: string | undefined, searchApiKey?: string) {
  let session: Session | undefined;
  let starting = false;
  let closed = false;
  let failed = false;
  let setupComplete = false;
  let ready = false;
  let searchCalls = 0;
  const activeSearches = new Map<string, AbortController>();

  function send(message: ServerMessage) {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > MAX_PENDING_BYTES) {
      socket.close(1013, 'Audio connection is overloaded');
      return;
    }
    socket.send(JSON.stringify(message));
  }

  function fail(message: string) {
    if (failed || closed) return;
    failed = true;
    send({ type: 'error', message });
    socket.close();
  }

  function sendReady() {
    if (session && setupComplete && !ready && !failed && !closed) {
      ready = true;
      send({ type: 'ready' });
    }
  }

  async function handleToolCall(call: FunctionCall) {
    if (!session || closed || failed || !call.id || !call.name) return;
    const callId = call.id;
    const callName = call.name;
    const abortController = new AbortController();
    activeSearches.set(callId, abortController);
    let response: Record<string, unknown>;
    if (callName !== 'web_search') {
      response = { error: 'This tool is not available.' };
    } else if (++searchCalls > MAX_SEARCH_CALLS_PER_SESSION) {
      response = { error: 'The per-session web search limit was reached. Continue without searching or start a new session.' };
    } else {
      try {
        const results = await searchTavily(call.args?.query, searchApiKey, abortController.signal);
        response = { output: { results } };
      } catch (error) {
        if (abortController.signal.aborted) return;
        response = { error: error instanceof Error ? error.message : 'The web search failed.' };
      }
    }
    activeSearches.delete(callId);
    if (abortController.signal.aborted || closed || failed || !session) return;
    try {
      session.sendToolResponse({
        functionResponses: {
          id: callId,
          name: callName,
          response,
          scheduling: FunctionResponseScheduling.INTERRUPT,
        },
      });
    } catch {
      fail('Could not return web search results. Start a new session.');
    }
  }

  function cancelToolCalls(ids: string[] | undefined) {
    for (const id of ids ?? []) {
      activeSearches.get(id)?.abort();
      activeSearches.delete(id);
    }
  }

  socket.on('message', async (raw, isBinary) => {
    if (isBinary) return fail('Invalid message.');
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw.toString());
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      message = parsed as Record<string, unknown>;
    } catch {
      return fail('Invalid message.');
    }
    if (message.type === 'start') {
      if (session || starting || !isModelId(message.model)) return fail('Invalid or unavailable model.');
      if (!apiKey || apiKey === 'your_gemini_api_key') return fail('Set GEMINI_API_KEY in your .env file and restart the server.');
      starting = true;
      try {
        const connected = await connectGemini(apiKey, message.model, {
          onmessage: (response) => {
            if (response.setupComplete) {
              setupComplete = true;
              sendReady();
            }
            mapGeminiMessage(response).forEach(send);
            cancelToolCalls(response.toolCallCancellation?.ids);
            for (const call of response.toolCall?.functionCalls ?? []) void handleToolCall(call);
          },
          onerror: () => { if (!closed) fail('Gemini connection failed. Check your API key and model access.'); },
          onclose: (event) => { if (!closed) fail(describeGeminiDisconnect(event)); },
        });
        if (closed || failed || socket.readyState !== WebSocket.OPEN) return connected.close();
        session = connected;
        sendReady();
      } catch (error) {
        if (!closed) fail(error instanceof VoiceInstructionsError ? error.message : 'Could not connect to Gemini. Check your API key, network, and model access.');
      } finally {
        starting = false;
      }
      return;
    }
    if (!session || !ready) return fail('Start a session before sending audio.');
    try {
      if (message.type === 'audio' && typeof message.data === 'string' && message.data.length > 0 && message.data.length <= MAX_AUDIO_BASE64 && /^[A-Za-z0-9+/]*={0,2}$/.test(message.data) && typeof message.sampleRate === 'number' && Number.isInteger(message.sampleRate) && message.sampleRate >= 8000 && message.sampleRate <= 96000) {
        session.sendRealtimeInput({ audio: { data: message.data, mimeType: `audio/pcm;rate=${message.sampleRate}` } });
      } else if (message.type === 'audio-end') {
        session.sendRealtimeInput({ audioStreamEnd: true });
      } else {
        fail('Invalid audio message.');
      }
    } catch {
      fail('The audio stream was interrupted. Start a new session.');
    }
  });
  socket.on('error', () => { socket.close(); });
  socket.on('close', () => {
    closed = true;
    activeSearches.forEach((controller) => controller.abort());
    activeSearches.clear();
    session?.close();
  });
}