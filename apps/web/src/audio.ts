export function encodeAudio(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeAudio(encoded: string): Float32Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(Math.floor(bytes.length / 2));
  for (let index = 0; index < samples.length; index++) samples[index] = view.getInt16(index * 2, true) / 32768;
  return samples;
}

export class AudioPlayback {
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private context: AudioContext;
  private onPlayingChange: (playing: boolean) => void;

  constructor(context: AudioContext, onPlayingChange: (playing: boolean) => void) {
    this.context = context;
    this.onPlayingChange = onPlayingChange;
  }

  enqueue(encoded: string) {
    const samples = decodeAudio(encoded);
    if (!samples.length) return;
    if (this.nextTime - this.context.currentTime > 10) throw new Error('Audio playback fell behind. Please reconnect.');
    const buffer = this.context.createBuffer(1, samples.length, 24000);
    buffer.getChannelData(0).set(samples);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      if (!this.sources.size) this.onPlayingChange(false);
    };
    const start = Math.max(this.context.currentTime, this.nextTime);
    source.start(start);
    this.nextTime = start + buffer.duration;
    this.onPlayingChange(true);
  }

  clear() {
    for (const source of this.sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    this.sources.clear();
    this.nextTime = 0;
    this.onPlayingChange(false);
  }
}