import { describe, expect, it, vi } from 'vitest';
import { AudioPlayback, decodeAudio, encodeAudio } from './audio';

describe('audio', () => {
  it('round-trips PCM bytes and decodes little-endian samples', () => {
    const bytes = new Uint8Array([0, 128, 0, 0, 255, 127]);
    expect(encodeAudio(bytes.buffer)).toBe('AIAAA P9/'.replace(' ', ''));
    expect(Array.from(decodeAudio(encodeAudio(bytes.buffer)))).toEqual([-1, 0, 32767 / 32768]);
  });

  it('stops every scheduled source on interruption', () => {
    const sources: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; onended: (() => void) | null; buffer: unknown }[] = [];
    const context = {
      currentTime: 0,
      destination: {},
      createBuffer: () => ({ duration: 1, getChannelData: () => new Float32Array(1) }),
      createBufferSource: () => {
        const source = { start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), connect: vi.fn(), onended: null, buffer: null };
        sources.push(source);
        return source;
      },
    } as unknown as AudioContext;
    const playing = vi.fn();
    const playback = new AudioPlayback(context, playing);
    playback.enqueue('AAA=');
    playback.enqueue('AAA=');
    playback.clear();
    expect(sources).toHaveLength(2);
    expect(sources.every((source) => source.stop.mock.calls.length === 1)).toBe(true);
    expect(playing).toHaveBeenLastCalledWith(false);
  });
});