import { Behavior, FunctionResponseScheduling, GoogleGenAI, Modality, ThinkingLevel, Type, type LiveServerMessage, type Session } from '@google/genai';
import { readFile } from 'node:fs/promises';
import type { ModelId, ServerMessage } from '../../../packages/shared/src/protocol';

export class VoiceInstructionsError extends Error {}

export function describeGeminiDisconnect(event: Pick<CloseEvent, 'code' | 'reason'>): string {
  const reason = event.reason.toLowerCase();
  if (/quota|resource.exhausted|rate.limit|\b429\b/.test(reason)) {
    return 'Gemini quota or rate limit reached. Check your Google AI Studio usage, billing, and model limits before retrying.';
  }
  if (/billing|payment/.test(reason)) {
    return 'Gemini rejected the connection due to billing. Check your Google AI Studio project billing before retrying.';
  }
  if (/api.key|authentication|unauthenticated|permission.denied|unauthorized/.test(reason)) {
    return 'Gemini rejected the API key or project permissions. Check your key and model access.';
  }
  if (/model.*(not.found|not.supported|not.available)|not.found.*model/.test(reason)) {
    return 'The selected Gemini model is not available for this API key. Choose another model or check model access.';
  }
  return 'Gemini disconnected. Start a new session to continue.';
}

export type VoiceInstructions = {
  voiceName: string;
  language: string;
  tone: string;
  speakingStyle: string;
  webSearch?: boolean;
  instructions: string[];
};

export function parseVoiceInstructions(contents: string): VoiceInstructions {
  try {
    const value: unknown = JSON.parse(contents);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const config = value as Record<string, unknown>;
    if (typeof config.voiceName !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(config.voiceName) ||
        typeof config.language !== 'string' || !config.language.trim() ||
        typeof config.tone !== 'string' || !config.tone.trim() ||
        typeof config.speakingStyle !== 'string' || !config.speakingStyle.trim() ||
        (config.webSearch !== undefined && typeof config.webSearch !== 'boolean') ||
        !Array.isArray(config.instructions) || !config.instructions.length ||
        !config.instructions.every((instruction: unknown) => typeof instruction === 'string' && instruction.trim())) throw new Error();
    return config as VoiceInstructions;
  } catch {
    throw new VoiceInstructionsError('Voice instructions are missing or invalid. Check apps/server/voice-agent.json.');
  }
}

export async function loadVoiceInstructions(): Promise<VoiceInstructions> {
  try {
    return parseVoiceInstructions(await readFile(new URL('../voice-agent.json', import.meta.url), 'utf8'));
  } catch {
    throw new VoiceInstructionsError('Voice instructions are missing or invalid. Check apps/server/voice-agent.json.');
  }
}

export function buildVoiceConfig(instructions: VoiceInstructions, model?: ModelId) {
  return {
    systemInstruction: [
      `Language: ${instructions.language}`,
      `Tone: ${instructions.tone}`,
      `Speaking style: ${instructions.speakingStyle}`,
      ...instructions.instructions,
    ].join('\n'),
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: instructions.voiceName } } },
    ...(instructions.webSearch ? {
      tools: [{
        functionDeclarations: [{
          name: 'web_search',
          description: 'Search the public web for recent or changing information. Return source titles, URLs, and short snippets. Use only a concise, non-sensitive query.',
          parameters: {
            type: Type.OBJECT,
            properties: { query: { type: Type.STRING, description: 'A concise web search query without sensitive personal information.' } },
            required: ['query'],
          },
          ...(model !== 'gemini-3.1-flash-live-preview' ? { behavior: Behavior.NON_BLOCKING } : {}),
        }],
      }],
    } : {}),
  };
}

export function mapGeminiMessage(message: LiveServerMessage): ServerMessage[] {
  const events: ServerMessage[] = [];
  const content = message.serverContent;
  if (content?.interrupted) events.push({ type: 'interrupted' });
  for (const part of content?.modelTurn?.parts ?? []) {
    if (part.inlineData?.data) events.push({ type: 'audio', data: part.inlineData.data });
  }
  if (content?.inputTranscription?.text) {
    events.push({ type: 'transcript', speaker: 'user', text: content.inputTranscription.text, finished: Boolean(content.inputTranscription.finished) });
  }
  if (content?.outputTranscription?.text) {
    events.push({ type: 'transcript', speaker: 'assistant', text: content.outputTranscription.text, finished: Boolean(content.outputTranscription.finished) });
  }
  if (content?.turnComplete) events.push({ type: 'turn-complete' });
  if (message.goAway) events.push({ type: 'notice', message: 'This session is ending soon. Reconnect to start a new conversation.' });
  return events;
}

export async function connectGemini(apiKey: string, model: ModelId, callbacks: {
  onmessage: (message: LiveServerMessage) => void;
  onerror: () => void;
  onclose: (event: CloseEvent) => void;
}): Promise<Session> {
  const voiceInstructions = await loadVoiceInstructions();
  const ai = new GoogleGenAI({ apiKey });
  return ai.live.connect({
    model,
    config: {
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      ...buildVoiceConfig(voiceInstructions, model),
      ...(model === 'gemini-3.8-live-extended-thinking' ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM } } : {}),
    },
    callbacks: { onopen: () => {}, ...callbacks },
  });
}