import type * as THREE from 'three';
import { parseThreeDo } from '../core/threeDo';
import { Replay, MAX_TICKS } from '../core/replay';
import { ASSET_ROOT, fetchBuffer } from '../render/assets';
import { LevelView } from '../render/levelView';
import { DIAMOND_CHAR, measure, type RGB } from '../render/text';
import { World, type Input } from '../sim/world';
import type { App, Screen } from './app';
import { VK_ESCAPE, VK_R } from './input';
import { CAMPAIGN, formatTime } from './maps';
import type { MapRecord } from './storage';
import { MainMenu } from './mainMenu';
import { Ending } from './ending';

const HUD: RGB = [100, 100, 255];
const CYAN: RGB = [100, 255, 255];
const RED: RGB = [255, 100, 100];
const GREEN: RGB = [100, 255, 100];
const WHITE: RGB = [255, 255, 255];
const MENU_ITEMS = ['CONTINUE TO NEXT LEVEL', 'RETURN TO GAME', 'RESTART LEVEL', 'SHOW REPLAY', 'QUIT TO MENU'];
const NO_RECORD = 1000; // best times under a second count as "no record"
const BANNER_END = 120; // 0x78
const NAME_AT = 80; // 0x50

export interface SessionOptions {
  /** Campaign level index (START GAME). */
  campaign?: number;
  /** Single map. */
  slug?: string;
  /** Start in replay playback (TOP SCORES). */
  playback?: Replay;
}

/**
 * One level being played (state 2): the per-frame logic of 0x40c9c0, the
 * level menu, the end-of-level banner, name entry and the HUD (0x40d170).
 */
export class LevelSession implements Screen {
  /** 1 = play and record, 2 = replay playback (0x423044). */
  private mode: 1 | 2;
  private recording = new Replay();
  private playback: Replay | null = null;
  private replayTick = 0;
  private best: MapRecord | null;

  /** Level clock in real milliseconds (0x52c810): HUD time, record time and model spin. */
  private clockMs = 0;
  private startPlayed = false;

  // Level menu (0x523fd0..0x523fe4)
  private over = false; // fd0: level ended (fell or finished): menu forced open, no RETURN TO GAME
  private menuOpen = false; // fd4
  private restartPending = false; // fdc
  private nextPending = false; // fe0
  private menuSel = 0; // fe4
  private menuDelay = 0; // 0x91332c
  private completed = false; // fd8: campaign level finished at least once -> CONTINUE allowed

  // End banner and name entry
  private banner = 0; // 0x9132f8
  private nameDelay = 0; // 0x913354
  private name = '';

  // FPS counter (0x407280)
  private fpsFrames = 0;
  private fpsWindowEnd = 0;
  private fps = 0;
  private fpsSum = 0;
  private fpsCount = 0;
  private fpsAvg = 0;
  /** Interpolation between the last two ticks, for drawing only. */
  private alpha = 0;

  private constructor(
    private app: App,
    readonly slug: string,
    private campaign: number | null,
    private world: World,
    private view: LevelView,
    best: MapRecord | null,
    playback: Replay | null,
  ) {
    this.best = best;
    this.mode = playback ? 2 : 1;
    this.playback = playback;
    this.reset();
  }

  static async create(app: App, opts: SessionOptions): Promise<LevelSession> {
    const campaign = opts.campaign ?? null;
    const slug = campaign !== null ? CAMPAIGN[campaign] : opts.slug!;
    const file = parseThreeDo(await fetchBuffer(`${ASSET_ROOT}maps/${slug}.3do`), slug);
    const world = new World(file);
    const view = await LevelView.create(file, world, app.textures);
    const best = await app.records.get(slug);
    app.audio.playMusic('game');
    return new LevelSession(app, slug, campaign, world, view, best, opts.playback ?? null);
  }

  private get bestMs(): number {
    return this.best?.timeMs ?? 0;
  }

  /** Restart (0x40b090) plus replay set-up (0x407640 with 3 = record, 0 = play back). */
  private reset(): void {
    this.world.reset();
    this.clockMs = 0;
    this.startPlayed = false;
    this.over = false;
    this.menuOpen = false;
    this.restartPending = false;
    this.nextPending = false;
    this.banner = 0;
    this.nameDelay = 0;
    this.fpsFrames = 0;
    this.fpsWindowEnd = 250;
    this.fpsSum = 0;
    this.fpsCount = 0;
    this.fpsAvg = 0;
    this.replayTick = 0;
    this.recording = new Replay();
  }

  private get isNewBest(): boolean {
    return this.clockMs < this.bestMs || this.bestMs < NO_RECORD;
  }

  frame(ticks: number, dtMs: number, alpha: number): void {
    const app = this.app, input = app.input, w = this.world;
    this.alpha = alpha;

    if (this.clockMs === 0 && !this.startPlayed) {
      app.audio.play('start', 63, 5);
      this.startPlayed = true;
    }

    // Timer (0x407280): the clock runs while diamonds remain and the menu is shut.
    if (w.diamondsPresent() > 0 && !this.menuOpen) this.clockMs += dtMs;
    this.countFps();

    if (!this.menuOpen) this.simulate(ticks);

    if (this.banner < 1 && input.lastKey === VK_ESCAPE) {
      this.menuOpen = true;
      this.restartPending = false;
      this.nextPending = false;
      this.menuSel = 0;
    }
    if (this.over) this.menuOpen = true;
    if (this.menuOpen && !this.restartPending && !this.nextPending) this.levelMenu(ticks);
    if (this.menuOpen && this.restartPending) {
      this.reset();
      return;
    }

    if (!this.over && w.diamondsPresent() === 0) {
      if (this.banner === 0) app.audio.play(this.isNewBest ? 'endbest' : 'end', 63, 5);
      this.banner += ticks;
      this.restartPending = false;
      this.nextPending = false;
    }
    if (this.isNewBest && this.mode === 1) this.nameEntry(ticks);
    if (this.banner >= BANNER_END) {
      this.banner = 0;
      this.nameDelay = 0;
      this.menuOpen = true;
      this.over = true;
      this.restartPending = false;
      this.menuSel = 0;
      if (this.isNewBest && this.mode === 1) {
        app.records.save(this.slug, Math.trunc(this.clockMs), this.name, this.recording);
        this.best = { timeMs: Math.trunc(this.clockMs), name: this.name, replay: this.recording };
      }
    }
    if (this.nextPending) {
      this.nextPending = false;
      this.nextLevel();
    }
  }

  private simulate(ticks: number): void {
    const app = this.app, input = app.input, w = this.world;
    for (let i = 0; i < ticks; i++) {
      let step: Input;
      if (this.mode === 2) {
        const p = this.playback!;
        const k = this.replayTick;
        step = { up: false, down: false, left: false, right: false, action: k < p.length ? p.actions[k] !== 0 : false };
      } else {
        step = { up: input.up, down: input.down, left: input.left, right: input.right, action: input.action };
      }
      w.step(step);
      for (const s of w.sounds) app.audio.play(s.sample, s.volume, s.count);
      w.sounds.length = 0;
      if (this.mode === 2) {
        const p = this.playback!;
        if (this.replayTick < p.length) w.overrideBall(p.positions[this.replayTick], p.velocities[this.replayTick]);
      } else if (this.recording.length < MAX_TICKS) {
        this.recording.push(w.position, w.velocity, step.action);
      }
      this.replayTick++;
    }
    // R restarts at once; falling off ends the level (0x40af4c..).
    if (input.lastKey === VK_R) {
      this.over = true;
      this.restartPending = true;
      this.nextPending = false;
      this.menuSel = 0;
    }
    if (w.lost) {
      this.over = true;
      this.restartPending = false;
      this.nextPending = false;
      this.menuSel = 0;
    }
    if (w.diamondsPresent() === 0) this.over = false;
    this.nextPending = false;
  }

  /** In-level menu (0x40ca82..0x40cca8). */
  private levelMenu(ticks: number): void {
    const app = this.app, input = app.input;
    this.menuDelay -= ticks;
    if (this.menuDelay > 50 || this.menuDelay < 0) this.menuDelay = 0;
    if (this.menuDelay === 0 && input.up) {
      this.menuSel--;
      this.menuDelay = 10;
      if (this.menuSel === 1 && this.over) this.menuSel--;
    }
    if (this.menuDelay === 0 && input.down) {
      this.menuSel++;
      this.menuDelay = 10;
      if (this.menuSel === 1 && this.over) this.menuSel++;
    }
    // CONTINUE is only reachable in the campaign once the level has been completed.
    let min = this.world.diamondsPresent() > 0 || this.campaign === null ? 1 : 0;
    if (min === 0) this.completed = true;
    if (this.completed) min = 0;
    if (this.menuSel > 4) this.menuSel = 4;
    if (this.menuSel < min) this.menuSel = min;
    if (min === 1 && this.menuSel === 1 && this.over) this.menuSel = 2;
    if (!input.action) return;

    this.menuDelay = 0;
    switch (this.menuSel) {
      case 0:
        this.nextPending = true;
        this.restartPending = false;
        this.mode = 1;
        break;
      case 1:
        this.menuOpen = false;
        break;
      case 2:
        this.restartPending = true;
        this.nextPending = false;
        this.mode = 1;
        this.playback = null;
        break;
      case 3:
        // SHOW REPLAY: restart, playing back what was just recorded.
        this.mode = 2;
        if (this.recording.length > 0 || !this.playback) this.playback = this.recording;
        this.over = true;
        this.menuOpen = true;
        this.restartPending = true;
        this.nextPending = false;
        break;
      case 4:
        input.consumeAction();
        app.show(MainMenu.create(app));
        break;
    }
  }

  /** Name entry for a new best (0x40cd6d..0x40ce22). */
  private nameEntry(ticks: number): void {
    const key = this.app.input.lastKey;
    if (this.banner >= NAME_AT && this.nameDelay === 0) {
      this.name = '';
      this.nameDelay = 15;
      this.banner = NAME_AT;
    }
    if (this.banner < NAME_AT || this.name.length >= 3) return;
    if (this.nameDelay <= 1 && key > 0x40 && key < 0x5b) {
      this.name += String.fromCharCode(key);
      this.nameDelay = 15;
    }
    this.nameDelay = Math.max(1, this.nameDelay - ticks);
    this.banner = NAME_AT;
  }

  private nextLevel(): void {
    const app = this.app;
    if (this.campaign !== null && this.campaign + 1 < CAMPAIGN.length) {
      const next = this.campaign + 1;
      app.show(LevelSession.create(app, { campaign: next }));
      return;
    }
    if (this.campaign !== null) {
      app.show(Ending.create(app));
      return;
    }
    app.show(MainMenu.create(app));
  }

  /** Frames per 250 ms of level clock, and the mean of those readings above 2. */
  private countFps(): void {
    this.fpsFrames++;
    if (this.clockMs <= this.fpsWindowEnd) return;
    const span = this.clockMs - this.fpsWindowEnd + 250;
    this.fps = Math.trunc((this.fpsFrames * 1000) / span);
    this.fpsFrames = 0;
    this.fpsWindowEnd = this.clockMs + 250;
    if (this.fps > 2) {
      this.fpsCount++;
      this.fpsSum += this.fps;
    }
    this.fpsAvg = this.fpsCount ? Math.trunc(this.fpsSum / this.fpsCount) : 0;
  }

  render(renderer: THREE.WebGLRenderer): void {
    const w = this.world, app = this.app;
    const L = this.view.lights;
    L.specularOn.value = app.specular > 0;
    const alpha = this.menuOpen ? 1 : this.alpha;
    this.view.update(alpha, this.clockMs);
    app.drawBackground(this.view.background, w.yaw, w.pitch);
    renderer.render(this.view.scene, this.view.camera);
    this.drawHud();
  }

  private drawHud(): void {
    const t = this.app.text, w = this.world;
    const fps = `${this.fps}/${this.fpsAvg}`;
    t.draw(320 - measure(fps, 16) * 0.5, 5, CYAN, 16, 16, fps);
    t.draw(5, 5, HUD, 30, 30, `BEST:${formatTime(this.bestMs)} ${this.best?.name ?? ''}`);
    t.draw(5, 38, HUD, 30, 30, `TIME:${formatTime(this.clockMs)}`);
    t.draw(5, 71, HUD, 30, 30, `SPEED:${w.speedKmh()}KMH`);
    t.draw(550, 5, WHITE, 30, 30, `${DIAMOND_CHAR} ${w.diamondsLeft()}`);

    if (this.banner > 0) this.drawBanner();

    if (this.menuOpen && !this.nextPending && !this.restartPending) {
      MENU_ITEMS.forEach((item, i) => {
        const text = i === 0 && this.campaign === null ? '' : item;
        t.draw(320 - measure(text, 32) * 0.5, 155 + 34 * i, i === this.menuSel ? RED : CYAN, 32, 32, text);
      });
    }
  }

  /** "LEVEL COMPLETED" / "BEST TIME" zoom and the name prompt (0x40e801). */
  private drawBanner(): void {
    const t = this.app.text, b = this.banner;
    const best = this.isNewBest;
    if (best && this.mode === 1 && b >= NAME_AT) {
      const size = 40 + (b - NAME_AT) / 2;
      const k = (320 - 2.5 * b) / 120;
      const c: RGB = [Math.trunc(255 * k), Math.trunc(100 * k), Math.trunc(100 * k)];
      const header = 'ENTER YOUR NAME:';
      t.draw(320 - measure(header, size) * 0.5, 220 - size, c, size, size, header);
      t.draw(320 - measure(this.name, size) * 0.5, 220, c, size, size, this.name);
      return;
    }
    const base: RGB = best ? RED : GREEN;
    const k = (120 - b) / 120;
    const c: RGB = [Math.trunc(base[0] * k), Math.trunc(base[1] * k), Math.trunc(base[2] * k)];
    const [l1, l2] = best ? ['BEST', 'TIME'] : ['LEVEL', 'COMPLETED'];
    const size = 2 * b;
    t.draw(320 - measure(l1, size) * 0.5, 220 - size, c, size, size, l1);
    t.draw(320 - measure(l2, size) * 0.5, 220, c, size, size, l2);
  }

  dispose(): void {
    this.view.dispose();
  }
}
