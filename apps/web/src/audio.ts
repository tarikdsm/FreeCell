import type { TurnRecord } from '@freecell/contracts';

type AudioCueId =
  | 'pickup'
  | 'drop'
  | 'foundation'
  | 'invalid'
  | 'hint'
  | 'shuffle'
  | 'restart'
  | 'victory';

type OscillatorWave = 'sine' | 'triangle' | 'sawtooth' | 'square';

type ToneLayer = {
  kind: 'tone';
  waveform: OscillatorWave;
  frequency: number;
  gain: number;
  duration: number;
  attack?: number;
  release?: number;
  detune?: number;
  sweepTo?: number;
  delay?: number;
  filterType?: BiquadFilterType;
  filterFrequency?: number;
  q?: number;
};

type NoiseLayer = {
  kind: 'noise';
  gain: number;
  duration: number;
  attack?: number;
  release?: number;
  delay?: number;
  filterType?: BiquadFilterType;
  filterFrequency?: number;
  q?: number;
};

type CueLayer = ToneLayer | NoiseLayer;

type CueDefinition = {
  layers: CueLayer[];
};

const cueBank: Record<AudioCueId, CueDefinition> = {
  pickup: {
    layers: [
      {
        kind: 'tone',
        waveform: 'triangle',
        frequency: 392,
        gain: 0.016,
        duration: 0.09,
        attack: 0.004,
        release: 0.06,
        filterType: 'lowpass',
        filterFrequency: 2400,
      },
      {
        kind: 'noise',
        gain: 0.005,
        duration: 0.05,
        attack: 0.001,
        release: 0.045,
        filterType: 'bandpass',
        filterFrequency: 2100,
        q: 1.2,
      },
    ],
  },
  drop: {
    layers: [
      {
        kind: 'tone',
        waveform: 'triangle',
        frequency: 329.63,
        gain: 0.018,
        duration: 0.12,
        attack: 0.003,
        release: 0.09,
        detune: -6,
        filterType: 'lowpass',
        filterFrequency: 2200,
      },
      {
        kind: 'noise',
        gain: 0.006,
        duration: 0.07,
        attack: 0.001,
        release: 0.05,
        filterType: 'bandpass',
        filterFrequency: 1400,
        q: 0.9,
      },
    ],
  },
  foundation: {
    layers: [
      {
        kind: 'tone',
        waveform: 'triangle',
        frequency: 493.88,
        gain: 0.02,
        duration: 0.14,
        attack: 0.004,
        release: 0.09,
        sweepTo: 554.37,
        filterType: 'lowpass',
        filterFrequency: 3000,
      },
      {
        kind: 'tone',
        waveform: 'sine',
        frequency: 739.99,
        gain: 0.008,
        duration: 0.12,
        attack: 0.01,
        release: 0.08,
        delay: 0.02,
      },
    ],
  },
  invalid: {
    layers: [
      {
        kind: 'tone',
        waveform: 'square',
        frequency: 196,
        gain: 0.01,
        duration: 0.1,
        attack: 0.002,
        release: 0.07,
        detune: 4,
        filterType: 'lowpass',
        filterFrequency: 1400,
      },
      {
        kind: 'tone',
        waveform: 'triangle',
        frequency: 174.61,
        gain: 0.008,
        duration: 0.08,
        attack: 0.002,
        release: 0.06,
        delay: 0.03,
      },
    ],
  },
  hint: {
    layers: [
      {
        kind: 'tone',
        waveform: 'sine',
        frequency: 523.25,
        gain: 0.012,
        duration: 0.12,
        attack: 0.006,
        release: 0.08,
      },
      {
        kind: 'tone',
        waveform: 'triangle',
        frequency: 659.25,
        gain: 0.012,
        duration: 0.14,
        attack: 0.006,
        release: 0.1,
        delay: 0.05,
      },
    ],
  },
  shuffle: {
    layers: [
      {
        kind: 'noise',
        gain: 0.01,
        duration: 0.18,
        attack: 0.002,
        release: 0.14,
        filterType: 'bandpass',
        filterFrequency: 900,
        q: 0.7,
      },
      {
        kind: 'tone',
        waveform: 'triangle',
        frequency: 261.63,
        gain: 0.01,
        duration: 0.16,
        attack: 0.01,
        release: 0.12,
        delay: 0.02,
        sweepTo: 349.23,
      },
    ],
  },
  restart: {
    layers: [
      {
        kind: 'tone',
        waveform: 'sine',
        frequency: 293.66,
        gain: 0.01,
        duration: 0.12,
        attack: 0.004,
        release: 0.08,
      },
      {
        kind: 'tone',
        waveform: 'triangle',
        frequency: 392,
        gain: 0.009,
        duration: 0.12,
        attack: 0.004,
        release: 0.08,
        delay: 0.035,
      },
    ],
  },
  victory: {
    layers: [
      {
        kind: 'tone',
        waveform: 'triangle',
        frequency: 523.25,
        gain: 0.016,
        duration: 0.28,
        attack: 0.008,
        release: 0.22,
      },
      {
        kind: 'tone',
        waveform: 'triangle',
        frequency: 659.25,
        gain: 0.016,
        duration: 0.28,
        attack: 0.008,
        release: 0.22,
        delay: 0.045,
      },
      {
        kind: 'tone',
        waveform: 'sine',
        frequency: 783.99,
        gain: 0.016,
        duration: 0.32,
        attack: 0.01,
        release: 0.26,
        delay: 0.09,
      },
    ],
  },
};

export class AudioDirector {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private effectsGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  unlock(): void {
    const AudioContextClass =
      window.AudioContext ??
      (
        window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;

    if (!AudioContextClass) {
      return;
    }

    if (!this.context) {
      this.context = new AudioContextClass();
      this.masterGain = this.context.createGain();
      this.effectsGain = this.context.createGain();
      this.masterGain.gain.value = 0.78;
      this.effectsGain.gain.value = 0.9;
      this.effectsGain.connect(this.masterGain);
      this.masterGain.connect(this.context.destination);
      this.noiseBuffer = this.createNoiseBuffer(this.context);
    }

    if (this.context.state === 'suspended') {
      void this.context.resume();
    }
  }

  playMove(turn: TurnRecord | null, terminal: boolean): void {
    if (terminal) {
      this.playCue('victory');
      return;
    }

    if (turn && turn.foundationDelta > 0) {
      this.playCue('foundation');
      return;
    }

    this.playCue('drop');
  }

  playPickup(): void {
    this.playCue('pickup');
  }

  playInvalid(): void {
    this.playCue('invalid');
  }

  playHint(): void {
    this.playCue('hint');
  }

  playShuffle(): void {
    this.playCue('shuffle');
  }

  playRestart(): void {
    this.playCue('restart');
  }

  private playCue(id: AudioCueId): void {
    if (!this.context || !this.effectsGain) {
      return;
    }

    const definition = cueBank[id];
    const startAt = this.context.currentTime + 0.002;

    definition.layers.forEach((layer) => {
      if (layer.kind === 'tone') {
        this.playToneLayer(layer, startAt);
        return;
      }

      this.playNoiseLayer(layer, startAt);
    });
  }

  private playToneLayer(layer: ToneLayer, startAt: number): void {
    if (!this.context || !this.effectsGain) {
      return;
    }

    const oscillator = this.context.createOscillator();
    oscillator.type = layer.waveform;
    oscillator.frequency.setValueAtTime(layer.frequency, startAt);
    if (layer.sweepTo) {
      oscillator.frequency.exponentialRampToValueAtTime(layer.sweepTo, startAt + layer.duration);
    }
    if (layer.detune) {
      oscillator.detune.setValueAtTime(layer.detune, startAt);
    }

    const gain = this.context.createGain();
    this.applyEnvelope(gain, layer.gain, layer.duration, startAt + (layer.delay ?? 0), layer);

    const output = this.connectOptionalFilter(layer, oscillator, gain);
    output.connect(this.effectsGain);

    oscillator.start(startAt + (layer.delay ?? 0));
    oscillator.stop(startAt + (layer.delay ?? 0) + layer.duration + 0.02);
  }

  private playNoiseLayer(layer: NoiseLayer, startAt: number): void {
    if (!this.context || !this.effectsGain || !this.noiseBuffer) {
      return;
    }

    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;

    const gain = this.context.createGain();
    this.applyEnvelope(gain, layer.gain, layer.duration, startAt + (layer.delay ?? 0), layer);

    const output = this.connectOptionalFilter(layer, source, gain);
    output.connect(this.effectsGain);

    source.start(startAt + (layer.delay ?? 0));
    source.stop(startAt + (layer.delay ?? 0) + layer.duration + 0.02);
  }

  private connectOptionalFilter(layer: CueLayer, input: AudioNode, gain: GainNode): AudioNode {
    if (!this.context || !layer.filterType || !layer.filterFrequency) {
      input.connect(gain);
      return gain;
    }

    const filter = this.context.createBiquadFilter();
    filter.type = layer.filterType;
    filter.frequency.setValueAtTime(layer.filterFrequency, this.context.currentTime);
    filter.Q.value = layer.q ?? Math.SQRT1_2;
    input.connect(filter);
    filter.connect(gain);
    return gain;
  }

  private applyEnvelope(
    gain: GainNode,
    peak: number,
    duration: number,
    startAt: number,
    layer: Pick<CueLayer, 'attack' | 'release'>,
  ): void {
    const attack = layer.attack ?? 0.005;
    const release = layer.release ?? Math.max(0.04, duration * 0.75);
    const fadeStart = Math.max(startAt + attack, startAt + duration - release);

    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peak, startAt + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, fadeStart + release);
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const frameCount = Math.max(1, Math.floor(context.sampleRate * 0.5));
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const channel = buffer.getChannelData(0);

    for (let index = 0; index < frameCount; index += 1) {
      channel[index] = Math.random() * 2 - 1;
    }

    return buffer;
  }
}
