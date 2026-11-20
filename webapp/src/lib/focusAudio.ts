import type { NoiseKind } from './focusTimer';

/**
 * Focus timer sounds, synthesized with Web Audio (no audio files): a bell when
 * a phase ends and looping ambient noise while focusing. Browsers only let a
 * page start audio after the user interacted with it, so the context is
 * created on a click (start, resume, or any click while a session runs).
 */

export type ChimeKind = 'focus' | 'break';

type AudioContextClass = typeof AudioContext;

let context: AudioContext | null = null;

function getContext(create: boolean): AudioContext | null {
  if (context || !create || typeof window === 'undefined') return context;
  const Ctor: AudioContextClass | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}

/** Create or resume the audio context; call from a user gesture. */
export function unlockAudio(): void {
  const ctx = getContext(true);
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
}

const audible = (ctx: AudioContext | null): ctx is AudioContext => ctx != null && ctx.state === 'running';

/** A short bell motif starting at audio time `at`. */
function bell(ctx: AudioContext, at: number, kind: ChimeKind): () => void {
  // Focus over: rising A5–E6–A6, twice. Break over: E6–B5, twice.
  const notes = kind === 'focus' ? [880, 1318.5, 1760] : [1318.5, 987.77];
  const oscillators: OscillatorNode[] = [];
  for (let round = 0; round < 2; round++) {
    notes.forEach((frequency, index) => {
      const start = at + round * 1.1 + index * 0.2;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.4);
      gain.connect(ctx.destination);
      // A slightly sharp octave partial gives the sine a bell's shimmer.
      for (const [ratio, level] of [[1, 1], [2.005, 0.18]] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = frequency * ratio;
        const partial = ctx.createGain();
        partial.gain.value = level;
        osc.connect(partial).connect(gain);
        osc.start(start);
        osc.stop(start + 1.5);
        oscillators.push(osc);
      }
    });
  }
  return () => {
    for (const osc of oscillators) {
      try {
        osc.stop();
      } catch {
        // already stopped
      }
    }
  };
}

let scheduled: { at: number; kind: ChimeKind; audioTime: number; stop: () => void } | null = null;

/**
 * Schedule the bell for the end of the running phase (`at`, epoch ms) on the
 * audio clock, which background tabs do not throttle; null cancels it.
 */
export function scheduleChime(at: number | null, kind: ChimeKind): void {
  if (scheduled && scheduled.at === at && scheduled.kind === kind) return;
  scheduled?.stop();
  scheduled = null;
  const ctx = getContext(false);
  if (at == null || !audible(ctx)) return;
  const delay = (at - Date.now()) / 1000;
  if (delay <= 0.05 || delay > 4 * 3600) return;
  const audioTime = ctx.currentTime + delay;
  scheduled = { at, kind, audioTime, stop: bell(ctx, audioTime, kind) };
}

/** Ring for a phase that has just ended, unless the scheduled bell already did. */
export function chimeNow(at: number, kind: ChimeKind): void {
  const ctx = getContext(false);
  if (scheduled && scheduled.at === at) {
    const played = audible(ctx) && ctx.currentTime >= scheduled.audioTime - 0.3;
    if (played) {
      scheduled = null;
      return;
    }
    // The audio clock stood still (the computer slept): ring now instead.
    scheduled.stop();
    scheduled = null;
  }
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  bell(ctx, ctx.currentTime + 0.05, kind);
}

// --- Ambient noise ---

const LOOP_SECONDS = 6;
/** Rough loudness match between the colors at the same volume setting. */
const NOISE_GAIN: Record<Exclude<NoiseKind, 'off'>, number> = { white: 0.18, pink: 0.45, brown: 0.6 };
const buffers = new Map<NoiseKind, AudioBuffer>();

function noiseBuffer(ctx: AudioContext, kind: Exclude<NoiseKind, 'off'>): AudioBuffer {
  const cached = buffers.get(kind);
  if (cached && cached.sampleRate === ctx.sampleRate) return cached;
  const length = Math.floor(ctx.sampleRate * LOOP_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === 'white') {
      data[i] = white;
    } else if (kind === 'pink') {
      // Paul Kellet's refined pink filter.
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    } else {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }
  // Cross-fade the tail into the head so the loop has no seam to click on.
  const fade = Math.floor(ctx.sampleRate * 0.25);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    data[length - fade + i] = data[length - fade + i] * (1 - t) + data[i] * t;
  }
  buffers.set(kind, buffer);
  return buffer;
}

let noise: { kind: NoiseKind; source: AudioBufferSourceNode; gain: GainNode } | null = null;

const noiseLevel = (kind: Exclude<NoiseKind, 'off'>, volume: number) => NOISE_GAIN[kind] * (Math.max(0, Math.min(100, volume)) / 100) ** 2;

/** Play (or stop, with 'off') the ambient noise at `volume` (0-100). */
export function setNoise(kind: NoiseKind, volume: number): void {
  const ctx = getContext(false);
  if (kind === 'off' || volume <= 0 || !audible(ctx)) {
    if (noise && ctx) {
      const { source, gain } = noise;
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      source.stop(ctx.currentTime + 0.8);
    }
    noise = null;
    return;
  }
  if (noise && noise.kind === kind) {
    noise.gain.gain.setTargetAtTime(noiseLevel(kind, volume), ctx.currentTime, 0.1);
    return;
  }
  setNoise('off', 0);
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, kind);
  source.loop = true;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.setTargetAtTime(noiseLevel(kind, volume), ctx.currentTime, 0.4);
  source.connect(gain).connect(ctx.destination);
  source.start();
  noise = { kind, source, gain };
}
