import { describe, expect, it } from 'vitest';
import { LiveServerMessage } from '@google/genai';
import { isModelId, models } from '../../../packages/shared/src/protocol';
import { buildVoiceConfig, describeGeminiDisconnect, loadVoiceInstructions, mapGeminiMessage, parseVoiceInstructions, VoiceInstructionsError } from './gemini';

describe('live protocol', () => {
  it('only accepts known live models', () => {
    expect(isModelId('gemini-3.8-live')).toBe(true);
    expect(isModelId('gemini-3.8-live-extended-thinking')).toBe(true);
    expect(isModelId('gemini-3.1-flash-live-preview')).toBe(true);
    expect(isModelId('gemini-2.5-flash-native-audio-preview-12-2025')).toBe(true);
    expect(isModelId('gemini-other')).toBe(false);
  });

  it('only exposes models documented as free-tier Live models', () => {
    expect(models.every((model) => model.freeTier)).toBe(true);
    expect(models.map((model) => model.id)).toEqual([
      'gemini-3.8-live',
      'gemini-3.8-live-extended-thinking',
      'gemini-3.1-flash-live-preview',
      'gemini-2.5-flash-native-audio-preview-12-2025',
    ]);
    expect(models.every((model) => model.label.includes('Free tier'))).toBe(true);
    expect(isModelId('gemini-3.8-flash')).toBe(false);
    expect(isModelId('gemini-3.5-flash-lite')).toBe(false);
  });

  it('maps all content parts and interruption events in order', () => {
    const message = new LiveServerMessage();
    message.serverContent = { interrupted: true, modelTurn: { parts: [{ inlineData: { data: 'YQ==' } }, { inlineData: { data: 'Yg==' } }] }, inputTranscription: { text: 'Hello' }, turnComplete: true };
    const events = mapGeminiMessage(message);
    expect(events.map((event) => event.type)).toEqual(['interrupted', 'audio', 'audio', 'transcript', 'turn-complete']);
  });

  it('reports safe actionable provider errors', () => {
    expect(describeGeminiDisconnect({ code: 1011, reason: 'Resource exhausted: quota exceeded. Check billing.' })).toContain('quota');
    expect(describeGeminiDisconnect({ code: 1008, reason: 'API key invalid' })).toContain('API key');
    expect(describeGeminiDisconnect({ code: 1008, reason: 'Model not found' })).toContain('model');
    expect(describeGeminiDisconnect({ code: 1011, reason: 'secret-value' })).not.toContain('secret-value');
  });
});

describe('voice instructions', () => {
  it('loads the editable instruction file into the Gemini voice configuration', async () => {
    const instructions = await loadVoiceInstructions();
    const config = buildVoiceConfig(instructions);
    expect(instructions.voiceName).toBe('Algenib');
    expect(config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(instructions.voiceName);
    expect(config.systemInstruction).toContain(instructions.language);
    expect(config.systemInstruction).toContain('distinctly American accent');
    expect(config.systemInstruction).toContain(instructions.tone);
    expect(config.systemInstruction).toContain(instructions.speakingStyle);
    expect(config.systemInstruction).toContain(instructions.instructions[0]);
    expect(instructions.webSearch).toBe(true);
    expect(config.tools?.[0].functionDeclarations?.[0].name).toBe('web_search');
    expect(config.tools?.[0].functionDeclarations?.[0].behavior).toBe('NON_BLOCKING');
  });

  it('rejects invalid JSON and missing voice instructions', () => {
    expect(() => parseVoiceInstructions('{')).toThrow(VoiceInstructionsError);
    expect(() => parseVoiceInstructions(JSON.stringify({ voiceName: 'Kore' }))).toThrow(VoiceInstructionsError);
    expect(() => parseVoiceInstructions(JSON.stringify({ voiceName: '', language: 'English', tone: 'Warm', speakingStyle: 'Clear', instructions: ['Help'] }))).toThrow(VoiceInstructionsError);
  });

  it('uses the edited voice, language, tone, style, and instructions', () => {
    const instructions = parseVoiceInstructions(JSON.stringify({ voiceName: 'Puck', language: 'Speak Spanish', tone: 'Friendly', speakingStyle: 'Slowly', instructions: ['Be brief'] }));
    expect(buildVoiceConfig(instructions)).toEqual({
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
      systemInstruction: 'Language: Speak Spanish\nTone: Friendly\nSpeaking style: Slowly\nBe brief',
    });
  });

  it('declares web search only when configured and uses blocking calls on the legacy live model', () => {
    const config = { voiceName: 'Kore', language: 'English', tone: 'Warm', speakingStyle: 'Clear', instructions: ['Help'] };
    expect(buildVoiceConfig({ ...config, webSearch: true }).tools?.[0].functionDeclarations?.[0].name).toBe('web_search');
    expect(buildVoiceConfig({ ...config, webSearch: true }, 'gemini-3.1-flash-live-preview').tools?.[0].functionDeclarations?.[0].behavior).toBeUndefined();
    expect(buildVoiceConfig({ ...config, webSearch: false }).tools).toBeUndefined();
    expect(buildVoiceConfig(config).tools).toBeUndefined();
    expect(() => parseVoiceInstructions(JSON.stringify({ ...config, webSearch: 'true' }))).toThrow(VoiceInstructionsError);
  });
});