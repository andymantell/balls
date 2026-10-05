import { ASSET_ROOT, fetchBuffer } from '../render/assets';

/**
 * Sound effects and music through Web Audio.
 *
 * The original plays samples through MIDAS (0x406f60): rate 22000 Hz, volume
 * 0..63, centre pan, started `count` times at once on free channels, which
 * simply makes a sample louder. Music is the two Impulse Tracker modules,
 * pre-rendered to Ogg Vorbis (AAC for Safari) and looped.
 */

export const SAMPLES = ['boun', 'dia', 'thun', 'end', 'start', 'endbest', 'bnormal', 'bred', 'bgreen', 'bblue', 'byellow'] as const;
export type SampleName = (typeof SAMPLES)[number];

const SAMPLE_RATE = 22000;
const CHANNEL_GAIN = 0.35; // one MIDAS channel at volume 63 relative to full scale

export class Audio {
  private ctx: AudioContext | null = null;
  private samples = new Map<string, AudioBuffer>();
  private music = new Map<string, Promise<AudioBuffer | null>>();
  private musicSource: AudioBufferSourceNode | null = null;
  private musicName = '';
  private sfxGain!: GainNode;
  private musicGain!: GainNode;
  private loading: Promise<void> | null = null;

  /** Must be called from a user gesture before anything is audible. */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.8;
      this.musicGain.connect(this.ctx.destination);
      this.loading = this.loadSamples();
      if (this.musicName) {
        const name = this.musicName;
        this.musicName = '';
        this.playMusic(name);
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get unlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  private async loadSamples(): Promise<void> {
    const ctx = this.ctx!;
    await Promise.all(
      SAMPLES.map(async (name) => {
        try {
          this.samples.set(name, await ctx.decodeAudioData(await fetchBuffer(`${ASSET_ROOT}sounds/${name}.wav`)));
        } catch (e) {
          console.warn(`sound ${name}:`, e);
        }
      }),
    );
  }

  /** playSample(sample, rate 22000, volume 0..63, count). */
  play(name: string, volume = 63, count = 1): void {
    const ctx = this.ctx;
    const buffer = this.samples.get(name);
    if (!ctx || !buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    // MIDAS resamples to 22 kHz playback regardless of the file's own rate.
    src.playbackRate.value = SAMPLE_RATE / buffer.sampleRate;
    const gain = ctx.createGain();
    gain.gain.value = (Math.max(0, Math.min(63, volume)) / 63) * count * CHANNEL_GAIN;
    src.connect(gain).connect(this.sfxGain);
    src.start();
  }

  playMusic(name: string): void {
    if (name === this.musicName) return;
    this.musicName = name;
    const ctx = this.ctx;
    if (!ctx) return;
    this.stopMusic();
    void this.loadMusic(name).then((buffer) => {
      if (!buffer || this.musicName !== name || this.musicSource) return;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.connect(this.musicGain);
      src.start();
      this.musicSource = src;
    });
  }

  private stopMusic(): void {
    if (this.musicSource) {
      try {
        this.musicSource.stop();
      } catch {
        /* already stopped */
      }
      this.musicSource.disconnect();
      this.musicSource = null;
    }
  }

  private loadMusic(name: string): Promise<AudioBuffer | null> {
    let p = this.music.get(name);
    if (!p) {
      const ctx = this.ctx!;
      const probe = document.createElement('audio');
      const ext = probe.canPlayType('audio/ogg; codecs="vorbis"') ? 'ogg' : 'm4a';
      p = fetchBuffer(`${ASSET_ROOT}music/${name}.${ext}`)
        .then((b) => ctx.decodeAudioData(b))
        .catch((e) => {
          console.warn(`music ${name}:`, e);
          return null;
        });
      this.music.set(name, p);
    }
    return p;
  }

  async ready(): Promise<void> {
    await this.loading;
  }
}
