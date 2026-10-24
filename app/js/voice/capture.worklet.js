// Runs on the audio thread: gathers microphone samples into 512-sample frames
// and sends each one straight to the recognition worker, so speech capture
// never waits on the busy main thread.

class SyrixCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(512);
    this.n = 0;
    this.out = null;
    this.level = 0;
    this.tick = 0;
    this.port.onmessage = (e) => { if (e.data && e.data.port) this.out = e.data.port; };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let sum = 0;
    for (let i = 0; i < ch.length; i++) {
      const s = ch[i];
      sum += s * s;
      this.frame[this.n++] = s;
      if (this.n === 512) {
        if (this.out) this.out.postMessage(this.frame, [this.frame.buffer]);
        this.frame = new Float32Array(512);
        this.n = 0;
      }
    }
    this.level = Math.max(Math.sqrt(sum / ch.length), this.level * 0.85);
    if (++this.tick % 4 === 0) this.port.postMessage({ level: this.level });
    return true;
  }
}

registerProcessor('syrix-capture', SyrixCapture);
