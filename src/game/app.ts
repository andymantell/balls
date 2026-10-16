import * as THREE from 'three';
import { TextureCache } from '../render/assets';
import { TextLayer } from '../render/text';
import { Background } from '../render/background';
import { Audio } from './audio';
import { InputState } from './input';
import { Records, loadSettings, saveSettings, type Settings } from './storage';

/** A top-level game state (main menu, level, ending). */
export interface Screen {
  /** One rendered frame: `ticks` whole 16 ms ticks elapsed, `dtMs` real time (0x40b820). */
  frame(ticks: number, dtMs: number, alpha: number): void;
  /** Draws the 3D part; text goes through app.text. */
  render(renderer: THREE.WebGLRenderer): void;
  dispose(): void;
  /** True while the screen waits for typed letters (record initials); used by touch controls. */
  wantsTextInput?(): boolean;
}

const TICK_MS = 16;
const MAX_FRAME_MS = 2000; // longer frames are dropped entirely, like the original

/**
 * Owns the WebGL renderer, the 640x480 virtual screen, timing and the shared
 * services. The picture is always 4:3 (letterboxed), like the fullscreen
 * 640x480 mode the game ran in.
 */
export class App {
  readonly renderer: THREE.WebGLRenderer;
  readonly textures = new TextureCache();
  readonly text = new TextLayer();
  readonly background = new Background();
  readonly audio = new Audio();
  readonly input = new InputState();
  readonly records = new Records();
  settings: Settings;

  private screen: Screen | null = null;
  private pending: Promise<Screen> | null = null;
  private lastTime = -1;
  private frac = 0;
  private msaaTarget: THREE.WebGLRenderTarget | null = null;
  private blit: { scene: THREE.Scene; camera: THREE.OrthographicCamera; material: THREE.MeshBasicMaterial } | null = null;
  private viewport = new THREE.Vector4();

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // the original has no colour management
    this.renderer.autoClear = false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.settings = loadSettings();
    this.input.bindings = [...this.settings.keys];
  }

  async init(): Promise<void> {
    await this.text.init(this.textures);
    this.input.attach(window);
    const unlock = () => this.audio.unlock();
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.applySettings();
  }

  saveSettings(): void {
    this.settings.keys = [...this.input.bindings];
    saveSettings(this.settings);
    this.applySettings();
  }

  /** Specular is a per-material uniform; antialiasing renders through an MSAA target. */
  applySettings(): void {
    this.resize();
  }

  /** Touch-device mode (set before the first screen): the main menu hides SETUP. */
  touchMode = false;

  /**
   * Touch layout hook: put the picture at the top of the window instead of the
   * middle, leaving room for on-screen controls below it. Off by default.
   */
  pictureAtTop = false;

  /** The 4:3 picture's rectangle in CSS pixels, measured from the window's top-left. */
  get pictureRect(): { x: number; y: number; width: number; height: number } {
    const v = this.viewport;
    return { x: v.x, y: window.innerHeight - v.y - v.w, width: v.z, height: v.w };
  }

  relayout(): void {
    this.resize();
  }

  wantsTextInput(): boolean {
    return this.screen?.wantsTextInput?.() ?? false;
  }

  get specular(): number {
    return this.settings.specular;
  }

  /** Switches to a screen once it has loaded; the old one keeps running meanwhile. */
  show(load: Promise<Screen>): void {
    const p = load.then((s) => {
      if (this.pending === p) {
        this.screen?.dispose();
        this.screen = s;
        this.pending = null;
        this.input.releaseAll();
      } else {
        s.dispose();
      }
      return s;
    });
    p.catch((e) => {
      console.error(e);
      if (this.pending === p) this.pending = null;
    });
    this.pending = p;
  }

  get loading(): boolean {
    return this.pending !== null;
  }

  start(): void {
    const loop = (t: number) => {
      requestAnimationFrame(loop);
      this.step(t);
    };
    requestAnimationFrame(loop);
  }

  private step(now: number): void {
    let dt = this.lastTime < 0 ? 0 : now - this.lastTime;
    this.lastTime = now;
    let ticks = 0;
    if (dt > MAX_FRAME_MS) dt = 0;
    else {
      this.frac += dt / TICK_MS;
      ticks = Math.floor(this.frac);
      this.frac -= ticks;
    }
    this.input.pollGamepad();
    this.renderer.setRenderTarget(null);
    this.renderer.setViewport(0, 0, this.canvas.width, this.canvas.height);
    this.renderer.setScissorTest(false);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear(true, true, true);
    if (!this.screen) return;
    this.screen.frame(ticks, dt, this.frac);
    this.draw();
  }

  private draw(): void {
    const r = this.renderer;
    const target = this.msaaTarget;
    r.setRenderTarget(target);
    if (target) r.setViewport(0, 0, target.width, target.height);
    else r.setViewport(this.viewport);
    r.clear(true, true, true);
    this.screen!.render(r);
    r.clearDepth();
    this.text.flush();
    r.render(this.text.scene, this.text.camera);
    if (target && this.blit) {
      r.setRenderTarget(null);
      r.setViewport(this.viewport);
      r.render(this.blit.scene, this.blit.camera);
    }
  }

  /** Background + scene, sharing the frame's viewport. */
  drawBackground(texture: THREE.Texture | null, yaw: number, pitch: number): void {
    this.background.texture = texture;
    if (!this.background.visible) return;
    this.background.update(yaw, pitch);
    this.renderer.render(this.background.scene, this.background.camera);
    this.renderer.clearDepth();
  }

  private resize(): void {
    const ratio = this.renderer.getPixelRatio();
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const cw = Math.floor(w * ratio), ch = Math.floor(h * ratio);
    let vw = cw, vh = Math.floor((cw * 3) / 4);
    if (vh > ch) {
      vh = ch;
      vw = Math.floor((ch * 4) / 3);
    }
    // setViewport takes CSS pixels and applies the pixel ratio itself.
    // (y counts up from the bottom of the window.)
    const y = this.pictureAtTop ? (ch - vh) / ratio : (ch - vh) / 2 / ratio;
    this.viewport.set((cw - vw) / 2 / ratio, y, vw / ratio, vh / ratio);

    this.msaaTarget?.dispose();
    this.msaaTarget = null;
    if (this.settings.antialias) {
      this.msaaTarget = new THREE.WebGLRenderTarget(vw, vh, { samples: 4, depthBuffer: true });
      if (!this.blit) {
        const material = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
        const scene = new THREE.Scene();
        scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
        this.blit = { scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1), material };
      }
      this.blit.material.map = this.msaaTarget.texture;
      this.blit.material.needsUpdate = true;
    }
  }
}
