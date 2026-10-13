/**
 * Fully synthesized audio: no asset files. SFX are built from oscillators and
 * filtered noise; music is a small drum + bass sequencer in a gladiatorial mood.
 */

type Bus = 'sfx' | 'music' | 'crowd';

class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  buses!: Record<Bus, GainNode>;
  private noiseBuf: AudioBuffer | null = null;
  crowdNode: AudioBufferSourceNode | null = null;
  private crowdGain: GainNode | null = null;
  private crowdFilter: BiquadFilterNode | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private nextNoteTime = 0;
  musicTrack: 'menu' | 'battle' | 'tension' | 'none' = 'none';
  volumes = { master: 0.8, sfx: 0.9, music: 0.55, crowd: 0.6 };
  private lastPlayed = new Map<string, number>();

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.buses = {
      sfx: ctx.createGain(),
      music: ctx.createGain(),
      crowd: ctx.createGain(),
    };
    for (const b of Object.values(this.buses)) b.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startCrowd();
    if (this.musicTrack !== 'none') this.startMusicLoop();
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.buses.sfx.gain.value = this.volumes.sfx;
    this.buses.music.gain.value = this.volumes.music * 0.5;
    this.buses.crowd.gain.value = this.volumes.crowd;
  }

  private throttle(key: string, ms: number) {
    const now = performance.now();
    const last = this.lastPlayed.get(key) ?? 0;
    if (now - last < ms) return false;
    this.lastPlayed.set(key, now);
    return true;
  }

  private noise(dur: number, filterType: BiquadFilterType, f0: number, f1: number, gain: number, q = 1, bus: Bus = 'sfx', delay = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.buses[bus]);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, bus: Bus = 'sfx', delay = 0, attack = 0.005) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.buses[bus]);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ---------- SFX ----------

  whoosh(power = 1) {
    if (!this.throttle('whoosh', 40)) return;
    const p = Math.min(1.5, power);
    this.noise(0.18 + p * 0.1, 'bandpass', 500 + p * 400, 2400 + p * 1200, 0.18 * p, 1.4);
  }

  hit(power = 1) {
    if (!this.throttle('hit', 30)) return;
    const p = Math.min(2, power);
    this.tone('sine', 160 + Math.random() * 30, 45, 0.18 + p * 0.08, 0.6 * Math.min(1, 0.4 + p * 0.4));
    this.noise(0.12, 'lowpass', 3000, 300, 0.35 * Math.min(1, p), 0.7);
    if (p > 1.1) this.tone('triangle', 90, 30, 0.35, 0.4);
  }

  clang(power = 1) {
    if (!this.throttle('clang', 50)) return;
    const base = 900 + Math.random() * 500;
    const g = 0.12 * Math.min(1.6, power);
    for (const m of [1, 2.76, 4.07, 5.4]) this.tone('square', base * m * 0.5, base * m * 0.48, 0.35 / Math.sqrt(m), g / m);
    this.noise(0.06, 'highpass', 6000, 3000, 0.25 * Math.min(1, power));
  }

  thud(power = 1) {
    if (!this.throttle('thud', 45)) return;
    this.tone('sine', 110, 40, 0.15, 0.3 * Math.min(1, power));
    this.noise(0.08, 'lowpass', 900, 200, 0.2 * Math.min(1, power));
  }

  jump() {
    if (!this.throttle('jump', 60)) return;
    this.tone('triangle', 220, 440, 0.12, 0.12);
    this.noise(0.08, 'bandpass', 800, 1600, 0.06);
  }

  dash() {
    this.noise(0.22, 'bandpass', 3000, 600, 0.2, 2);
  }

  block() {
    this.tone('square', 400, 300, 0.08, 0.1);
    this.noise(0.05, 'highpass', 5000, 3000, 0.12);
  }

  parry() {
    for (const f of [880, 1320, 1760]) this.tone('triangle', f, f * 1.02, 0.5, 0.12);
    this.tone('sine', 220, 880, 0.15, 0.1);
  }

  pickup() {
    this.tone('triangle', 520, 780, 0.08, 0.15);
    this.tone('triangle', 780, 1040, 0.1, 0.12, 'sfx', 0.06);
  }

  throwIt() {
    this.noise(0.25, 'bandpass', 1500, 400, 0.22, 3);
  }

  ringOut() {
    this.tone('sawtooth', 300, 60, 0.9, 0.18);
    this.noise(1.2, 'lowpass', 3000, 100, 0.3, 0.6);
    this.tone('sine', 80, 30, 1.0, 0.5);
  }

  explosion() {
    this.noise(1.0, 'lowpass', 4000, 60, 0.6, 0.5);
    this.tone('sine', 120, 25, 0.8, 0.7);
  }

  zap() {
    for (let i = 0; i < 4; i++) this.tone('sawtooth', 1800 - i * 300, 200, 0.12, 0.08, 'sfx', i * 0.04);
    this.noise(0.3, 'highpass', 4000, 1500, 0.2);
  }

  fire() {
    this.noise(0.5, 'bandpass', 600, 200, 0.2, 0.7);
  }

  splash() {
    this.noise(0.6, 'lowpass', 2500, 200, 0.4, 0.8);
  }

  legendary() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => this.tone('triangle', f, f, 0.6, 0.12, 'sfx', i * 0.07, 0.01));
    notes.forEach((f, i) => this.tone('sine', f * 2, f * 2, 0.4, 0.04, 'sfx', 0.1 + i * 0.07, 0.01));
  }

  coin() {
    this.tone('square', 988, 988, 0.07, 0.07);
    this.tone('square', 1319, 1319, 0.25, 0.07, 'sfx', 0.07);
  }

  uiMove() {
    if (!this.throttle('ui', 40)) return;
    this.tone('triangle', 660, 700, 0.05, 0.06);
  }

  uiSelect() {
    this.tone('triangle', 520, 1040, 0.09, 0.1);
    this.tone('sine', 1040, 1040, 0.12, 0.05, 'sfx', 0.05);
  }

  uiBack() {
    this.tone('triangle', 600, 300, 0.1, 0.09);
  }

  gong() {
    const base = 110;
    for (const m of [1, 1.5, 2.1, 2.9, 4.2]) this.tone('sine', base * m, base * m * 0.99, 2.5 / Math.sqrt(m), 0.25 / m, 'sfx', 0, 0.002);
    this.noise(0.4, 'bandpass', 1200, 400, 0.15, 2);
  }

  countdownBeep(final = false) {
    if (final) this.gong();
    else this.tone('square', 440, 440, 0.12, 0.08);
  }

  horn() {
    // triumphant brass-ish fanfare
    const seq = [392, 523.25, 659.25, 783.99];
    seq.forEach((f, i) => {
      this.tone('sawtooth', f, f, i === seq.length - 1 ? 0.9 : 0.18, 0.08, 'sfx', i * 0.16, 0.02);
      this.tone('square', f / 2, f / 2, i === seq.length - 1 ? 0.9 : 0.18, 0.04, 'sfx', i * 0.16, 0.02);
    });
  }

  // ---------- Crowd ----------

  private startCrowd() {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.buses.crowd);
    src.start();
    this.crowdNode = src;
    this.crowdGain = g;
    this.crowdFilter = f;
  }

  /** Continuous crowd murmur level 0..1. */
  setCrowd(level: number) {
    if (!this.ctx || !this.crowdGain || !this.crowdFilter) return;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.setTargetAtTime(0.03 + level * 0.12, t, 0.3);
    this.crowdFilter.frequency.setTargetAtTime(500 + level * 600, t, 0.3);
  }

  cheer(power = 1) {
    if (!this.throttle('cheer', 400)) return;
    const p = Math.min(1.5, power);
    this.noise(1.6 + p, 'bandpass', 900, 1400, 0.25 * p, 0.8, 'crowd');
    this.noise(1.4 + p, 'bandpass', 1800, 2200, 0.12 * p, 1.5, 'crowd', 0.05);
  }

  ooh() {
    if (!this.throttle('ooh', 600)) return;
    this.noise(1.2, 'bandpass', 400, 700, 0.3, 4, 'crowd');
    this.noise(1.2, 'bandpass', 500, 900, 0.2, 5, 'crowd', 0.05);
  }

  // ---------- Music ----------

  playMusic(track: 'menu' | 'battle' | 'tension' | 'none') {
    if (this.musicTrack === track) return;
    this.musicTrack = track;
    if (track === 'none') {
      this.stopMusicLoop();
      return;
    }
    if (this.ctx && this.musicTimer === null) this.startMusicLoop();
  }

  private stopMusicLoop() {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private startMusicLoop() {
    if (!this.ctx) return;
    this.stopMusicLoop();
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.musicStep = 0;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 50);
  }

  private scheduleMusic() {
    const ctx = this.ctx;
    if (!ctx || this.musicTrack === 'none') return;
    const bpm = this.musicTrack === 'menu' ? 84 : this.musicTrack === 'tension' ? 140 : 118;
    const stepDur = 60 / bpm / 4;
    while (this.nextNoteTime < ctx.currentTime + 0.15) {
      this.musicNote(this.musicStep, this.nextNoteTime);
      this.nextNoteTime += stepDur;
      this.musicStep = (this.musicStep + 1) % 64;
    }
  }

  private drum(t: number, f0: number, f1: number, dur: number, gain: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.buses.music);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hat(t: number, gain: number) {
    const ctx = this.ctx!;
    if (!this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f).connect(g).connect(this.buses.music);
    src.start(t, Math.random());
    src.stop(t + 0.06);
  }

  private pluck(t: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sawtooth') {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 6, t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.2, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.buses.music);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private musicNote(step: number, t: number) {
    // D phrygian dominant-ish: an "ancient arena" flavour
    const root = 73.42; // D2
    const scale = [0, 1, 4, 5, 7, 8, 10, 12];
    const semi = (n: number) => root * Math.pow(2, n / 12);
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const track = this.musicTrack;
    if (track === 'menu') {
      if (s === 0 || s === 10) this.drum(t, 90, 40, 0.5, 0.5);
      if (s === 8) this.drum(t, 140, 70, 0.25, 0.25);
      if (s % 4 === 2) this.hat(t, 0.03);
      const prog = [0, 0, 5, 4][bar % 4];
      if (s === 0) this.pluck(t, semi(scale[prog]), 1.6, 0.12, 'triangle');
      if (s % 4 === 0) {
        const mel = [7, 5, 4, 5, 7, 8, 7, 5, 4, 1, 0, 1, 4, 5, 4, 1];
        const n = mel[(bar * 4 + s / 4) % mel.length];
        this.pluck(t, semi(12 + n), 0.5, 0.05, 'triangle');
      }
    } else {
      const intense = track === 'tension';
      if (s === 0 || s === 6 || s === 10 || (intense && s === 14)) this.drum(t, 110, 38, 0.35, 0.65);
      if (s === 4 || s === 12) {
        this.drum(t, 220, 120, 0.12, 0.3);
        this.hat(t, 0.09);
      }
      if (s % 2 === 0 || intense) this.hat(t, s % 4 === 2 ? 0.05 : 0.025);
      const prog = [0, 0, 1, 0, 5, 4, 1, 0][bar % 8];
      const bassPat = [0, -1, 0, 12, -1, 0, 7, -1, 0, -1, 0, 12, -1, 10, 8, 7];
      const b = bassPat[s];
      if (b >= 0) this.pluck(t, semi(scale[prog % scale.length] + b - 12 + 12), 0.18, 0.11);
      if (s % 8 === 0 && bar % 2 === 1) {
        const lead = [12, 13, 16, 17, 19, 17, 16, 13];
        this.pluck(t, semi(lead[(bar + s / 8) % lead.length] + 12), 0.7, 0.035, 'square');
      }
    }
  }
}

export const audio = new AudioEngine();
