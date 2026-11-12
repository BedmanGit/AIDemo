export const models = [
  { id: 'gemini-3.8-live', label: 'Gemini 3.8 Live · Free tier', description: 'Fast, natural conversation', freeTier: true },
  { id: 'gemini-3.8-live-extended-thinking', label: 'Gemini 3.8 Live Extended Thinking · Free tier', description: 'More reasoning for complex tasks', freeTier: true },
  { id: 'gemini-3.1-flash-live-preview', label: 'Gemini 3.1 Flash Live · Free tier (Preview)', description: 'Legacy preview; availability may vary', freeTier: true },
  { id: 'gemini-2.5-flash-native-audio-preview-12-2025', label: 'Gemini 2.5 Flash Live · Free tier (Legacy preview)', description: 'Older preview; access may be limited', freeTier: true },
] as const;

export type ModelId = (typeof models)[number]['id'];

export function isModelId(value: unknown): value is ModelId {
  return typeof value === 'string' && models.some((model) => model.id === value);
}

export type ClientMessage =
  | { type: 'start'; model: ModelId }
  | { type: 'audio'; data: string; sampleRate: number }
  | { type: 'audio-end' };

export type ServerMessage =
  | { type: 'ready' }
  | { type: 'audio'; data: string }
  | { type: 'transcript'; speaker: 'user' | 'assistant'; text: string; finished: boolean }
  | { type: 'interrupted' }
  | { type: 'turn-complete' }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string };