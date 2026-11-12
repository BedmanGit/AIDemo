import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveServerMessage, type Session } from '@google/genai';
import { attachSession } from './session';
import { connectGemini, VoiceInstructionsError } from './gemini';

const provider = vi.hoisted(() => ({ sendRealtimeInput: vi.fn(), sendToolResponse: vi.fn(), close: vi.fn() }));
const providerCallbacks = vi.hoisted(() => ({ onmessage: undefined as ((message: unknown) => void) | undefined }));
vi.mock('./gemini', async (importOriginal) => {
  const original = await importOriginal<typeof import('./gemini')>();
  return { ...original, connectGemini: vi.fn(async (_apiKey, _model, callbacks) => {
    providerCallbacks.onmessage = callbacks.onmessage as (message: unknown) => void;
    queueMicrotask(() => callbacks.onmessage(Object.assign(new LiveServerMessage(), { setupComplete: {} })));
    return provider;
  }) };
});

let server: WebSocketServer | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  vi.clearAllMocks();
  providerCallbacks.onmessage = undefined;
  vi.unstubAllGlobals();
});

async function openSession(apiKey?: string, searchApiKey?: string) {
  server = new WebSocketServer({ port: 0 });
  await once(server, 'listening');
  server.on('connection', (socket) => attachSession(socket, apiKey, searchApiKey));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
  await once(socket, 'open');
  return socket;
}

describe('server session', () => {
  it('rejects unknown models and missing API keys', async () => {
    const socket = await openSession();
    const message = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'start', model: 'not-a-model' }));
    expect(JSON.parse((await message)[0].toString()).message).toContain('model');
    await once(socket, 'close');
  });

  it('reports a missing API key without exposing credentials', async () => {
    const socket = await openSession();
    const message = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'start', model: 'gemini-3.8-live' }));
    expect(JSON.parse((await message)[0].toString()).message).toContain('GEMINI_API_KEY');
    await once(socket, 'close');
  });

  it('reports invalid voice instructions', async () => {
    vi.mocked(connectGemini).mockRejectedValueOnce(new VoiceInstructionsError('Voice instructions are missing or invalid.'));
    const socket = await openSession('test-key');
    const message = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'start', model: 'gemini-3.8-live' }));
    expect(JSON.parse((await message)[0].toString()).message).toContain('Voice instructions');
    await once(socket, 'close');
  });

  it('runs web search on Tavily and returns bounded results to Gemini', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [
      { title: 'Recent update', url: 'https://example.com/update', content: 'A verified excerpt.' },
    ] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const socket = await openSession('test-gemini-key', 'test-tavily-key');
    const ready = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'start', model: 'gemini-3.8-live' }));
    expect(JSON.parse((await ready)[0].toString()).type).toBe('ready');

    const toolCall = new LiveServerMessage();
    toolCall.toolCall = { functionCalls: [{ id: 'search-1', name: 'web_search', args: { query: 'recent update' } }] };
    providerCallbacks.onmessage?.(toolCall);

    await vi.waitFor(() => expect(provider.sendToolResponse).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(provider.sendToolResponse).toHaveBeenCalledWith({
      functionResponses: {
        id: 'search-1',
        name: 'web_search',
        response: { output: { results: [{ title: 'Recent update', url: 'https://example.com/update', content: 'A verified excerpt.' }] } },
        scheduling: 'INTERRUPT',
      },
    });
    const closed = once(socket, 'close');
    socket.close();
    await closed;
  });

  it('returns a helpful tool result when Tavily is not configured', async () => {
    const socket = await openSession('test-gemini-key');
    const ready = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'start', model: 'gemini-3.8-live' }));
    await ready;

    const toolCall = new LiveServerMessage();
    toolCall.toolCall = { functionCalls: [{ id: 'search-2', name: 'web_search', args: { query: 'recent update' } }] };
    providerCallbacks.onmessage?.(toolCall);

    await vi.waitFor(() => expect(provider.sendToolResponse).toHaveBeenCalledOnce());
    expect(provider.sendToolResponse).toHaveBeenCalledWith(expect.objectContaining({
      functionResponses: expect.objectContaining({
        id: 'search-2',
        response: { error: expect.stringContaining('TAVILY_API_KEY') },
      }),
    }));
    const closed = once(socket, 'close');
    socket.close();
    await closed;
  });

  it('reports quota errors without exposing the provider reason', async () => {
    vi.mocked(connectGemini).mockImplementationOnce(async (_apiKey, _model, callbacks) => {
      queueMicrotask(() => callbacks.onclose({ code: 1011, reason: 'Quota exceeded; check billing. secret-value' } as CloseEvent));
      return provider as unknown as Session;
    });
    const socket = await openSession('test-key');
    const message = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'start', model: 'gemini-3.8-live' }));
    const result = JSON.parse((await message)[0].toString());
    expect(result.type).toBe('error');
    expect(result.message).toContain('quota');
    expect(result.message).not.toContain('secret-value');
    await once(socket, 'close');
  });

  it('forwards audio, flushes on mute, and closes the provider', async () => {
    const socket = await openSession('test-key');
    const ready = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'start', model: 'gemini-3.8-live' }));
    expect(JSON.parse((await ready)[0].toString()).type).toBe('ready');
    socket.send(JSON.stringify({ type: 'audio', data: 'AAA=', sampleRate: 48000 }));
    socket.send(JSON.stringify({ type: 'audio-end' }));
    await vi.waitFor(() => expect(provider.sendRealtimeInput).toHaveBeenCalledTimes(2));
    expect(provider.sendRealtimeInput).toHaveBeenCalledWith({ audio: { data: 'AAA=', mimeType: 'audio/pcm;rate=48000' } });
    expect(provider.sendRealtimeInput).toHaveBeenCalledWith({ audioStreamEnd: true });
    const closed = once(socket, 'close');
    socket.close();
    await closed;
    await vi.waitFor(() => expect(provider.close).toHaveBeenCalledOnce());
  });

  it('rejects malformed or oversized audio', async () => {
    const socket = await openSession('test-key');
    const ready = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'start', model: 'gemini-3.8-live' }));
    await ready;
    const message = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'audio', data: 'not base64!', sampleRate: 48000 }));
    expect(JSON.parse((await message)[0].toString()).message).toContain('Invalid audio');
    await once(socket, 'close');
    expect(provider.sendRealtimeInput).not.toHaveBeenCalled();
  });
});