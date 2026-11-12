class AudioCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(2048);
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const sample of channel) {
      this.samples[this.offset++] = sample;
      if (this.offset === this.samples.length) {
        const buffer = new ArrayBuffer(this.samples.length * 2);
        const view = new DataView(buffer);
        for (let index = 0; index < this.samples.length; index++) {
          const value = Math.max(-1, Math.min(1, this.samples[index]));
          view.setInt16(index * 2, value < 0 ? value * 32768 : value * 32767, true);
        }
        this.port.postMessage(buffer, [buffer]);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('audio-capture', AudioCapture);