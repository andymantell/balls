import type * as THREE from 'three';
import { loadModel } from '../render/assets';
import { MenuView } from '../render/menuView';
import { measure, type RGB } from '../render/text';
import type { App, Screen } from './app';
import { VK_ESCAPE } from './input';
import { MAPS, displayName, formatTime } from './maps';
import { isFirstRun } from './storage';
import { LevelSession } from './session';

const STEP = (2 * Math.PI) / 5; // 1.2566370616
const WHEEL_SPEED = 0.05; // radians per tick
const CAM_SPEED = 0.2; // units per millisecond
const CAM_WHEEL = -140;
const CAM_PAGE = -50;
const FADE_START = -80;
const ROW = 34;
const SIZE = 32;
const CYAN: RGB = [100, 255, 255];
const RED: RGB = [255, 100, 100];
const GREEN: RGB = [100, 255, 100];

enum Page {
  Wheel = 0,
  SingleMap = 1,
  TopScores = 3,
  Setup = 4,
  Controls = 5,
}

/** Wheel / page state that survives leaving the menu (globals in the original). */
const state = {
  initialised: false,
  camZ: 190, // 0x423120: the menu flies back from behind the logo once per run
  page: Page.Wheel,
  sel: 0, // 0x913328
  target: 0, // 0x913324
  current: 0, // 0x913320
  s: 0, // 0x91332c: wheel direction (-1/0/1) or repeat delay
  clockMs: 0, // 0x52c810
};

const SPECULAR = ['OFF', 'ON (NORMAL)', 'ON (DX6.1+AMD FIXED)'];
const ANTIALIAS = ['OFF', 'FULLSCENE'];
const CONTROL_LABELS = ['UP       ', 'DOWN     ', 'LEFT     ', 'RIGHT    ', 'ACTION   '];

/** The main menu (input 0x40b9e0, drawing 0x40ed00). */
export class MainMenu implements Screen {
  private waveMs0 = 0;
  private scores: { text: string; slug: string }[] = [];
  /** CHANGE CONTROLS capture state (0x913344): 0 idle, 1 wait release, 2 wait key, 3 wait release. */
  private capture = 0;

  private constructor(private app: App, private view: MenuView) {}

  static async create(app: App): Promise<MainMenu> {
    const view = await MenuView.create(await loadModel('menu'), app.textures, app.touchMode);
    const m = new MainMenu(app, view);
    if (!state.initialised) {
      state.initialised = true;
      if (isFirstRun() && !app.touchMode) {
        // No setup.dat: the wheel starts on SETUP (0x40b9c8).
        state.sel = 3;
        state.target = 3 * STEP;
      }
    }
    m.waveMs0 = state.clockMs;
    app.audio.playMusic('menu');
    await m.loadScores();
    return m;
  }

  private async loadScores(): Promise<void> {
    this.scores = [];
    for (const slug of MAPS) {
      const rec = await this.app.records.get(slug);
      const time = rec ? formatTime(rec.timeMs) : formatTime(0);
      this.scores.push({ slug, text: `${displayName(slug)} ${time} (${rec?.name ?? ''})` });
    }
  }

  frame(ticks: number, dtMs: number): void {
    state.clockMs += dtMs;
    this.handleInput(ticks);
    if (this.app.loading) return;

    // Camera dolly (per millisecond).
    if (state.page === Page.Wheel) state.camZ = Math.max(CAM_WHEEL, state.camZ - CAM_SPEED * dtMs);
    else if (state.page === Page.SingleMap || state.page === Page.TopScores || state.page === Page.Setup)
      state.camZ = Math.min(CAM_PAGE, state.camZ + CAM_SPEED * dtMs);
  }

  private handleInput(ticks: number): void {
    const app = this.app, input = app.input;
    if (app.loading) return;
    const up = input.up, down = input.down, action = input.action;
    const esc = input.lastKey === VK_ESCAPE;

    switch (state.page) {
      case Page.Wheel: {
        // The browser port has no QUIT (and touch devices no SETUP): the wheel
        // steps over their blanked slots.
        const hidden = (i: number) => i === 4 || (i === 3 && app.touchMode);
        if (state.s === 0 && up) {
          do {
            state.target -= STEP;
            state.sel = (state.sel + 4) % 5;
          } while (hidden(state.sel));
          state.s = -1;
        }
        if (state.s === 0 && down) {
          do {
            state.target += STEP;
            state.sel = (state.sel + 1) % 5;
          } while (hidden(state.sel));
          state.s = 1;
        }
        if (state.current > state.target && state.s === -1) state.current -= ticks * WHEEL_SPEED;
        else if (state.current < state.target && state.s === 1) state.current += ticks * WHEEL_SPEED;
        else {
          state.current = state.target;
          state.s = 0;
        }
        if (state.s !== 0 || !action) break;
        switch (state.sel) {
          case 0:
            input.consumeAction();
            app.show(LevelSession.create(app, { campaign: 0 }));
            return;
          case 1:
            this.openPage(Page.SingleMap, 0, 25);
            break;
          case 2:
            void this.loadScores();
            this.openPage(Page.TopScores, 0, 25);
            break;
          case 3:
            this.openPage(Page.Setup, 0, 25);
            break;
        }
        break;
      }

      case Page.SingleMap:
      case Page.TopScores: {
        this.listNav(up, down, MAPS.length, ticks);
        if (state.s === 0 && esc) {
          const back = state.page === Page.SingleMap ? 1 : 2;
          this.toWheel(back);
          break;
        }
        if (state.s !== 0 || !action) break;
        input.consumeAction();
        const slug = MAPS[state.sel];
        if (state.page === Page.SingleMap) {
          app.show(LevelSession.create(app, { slug }));
        } else {
          void app.records.get(slug).then((rec) => {
            if (!rec?.replay) return;
            app.show(LevelSession.create(app, { slug, playback: rec.replay! }));
          });
        }
        break;
      }

      case Page.Setup: {
        if (state.s === 0 && up) {
          state.sel--;
          state.s = 8;
        }
        if (state.s === 0 && down) {
          state.sel++;
          state.s = 8;
        }
        // Four positions although only three lines are drawn (the original's bound).
        if (state.sel > 3) state.sel = 0;
        if (state.sel < 0) state.sel = 3;
        state.s = Math.max(0, state.s - ticks);
        if (state.s === 0 && action) {
          if (state.sel === 0) {
            app.settings.specular = (app.settings.specular + 1) % 3;
            state.s = 15;
            input.consumeAction();
          } else if (state.sel === 1) {
            app.settings.antialias = (app.settings.antialias + 1) % 2;
            state.s = 15;
            input.consumeAction();
          } else if (state.sel === 2) {
            input.consumeAction();
            state.page = Page.Controls;
            state.sel = 0;
            state.s = 15;
            this.capture = 0;
          }
        }
        if (state.s === 0 && esc) {
          app.saveSettings();
          this.toWheel(3);
        }
        break;
      }

      case Page.Controls: {
        if (this.capture === 0) {
          if (state.s === 0 && up) {
            state.sel--;
            state.s = 8;
          }
          if (state.s === 0 && down) {
            state.sel++;
            state.s = 8;
          }
        }
        if (state.sel > 4) state.sel = 0;
        if (state.sel < 0) state.sel = 4;
        state.s = Math.max(0, state.s - ticks);
        if (state.s === 0 && this.capture === 0 && action) this.capture = 1;
        const key = input.lastKey;
        if (this.capture === 1 && key === 0) this.capture = 2;
        if (this.capture === 2 && key > 0) {
          input.bindings[state.sel] = key;
          input.flags.fill(false);
          this.capture = 3;
        }
        if (this.capture === 3 && input.lastKey === 0) this.capture = 0;
        if (state.s === 0 && this.capture === 0 && input.lastKey === VK_ESCAPE) {
          app.saveSettings();
          input.releaseAll();
          state.page = Page.Setup;
          state.sel = 2;
          state.s = 15;
        }
        break;
      }
    }
  }

  private listNav(up: boolean, down: boolean, count: number, ticks: number): void {
    if (state.s === 0 && up) {
      state.sel--;
      state.s = -8;
    }
    if (state.s === 0 && down) {
      state.sel++;
      state.s = 8;
    }
    if (state.sel > count - 1) state.sel = 0;
    if (state.sel < 0) state.sel = count - 1;
    if (state.s > 0) state.s = Math.max(0, state.s - ticks);
    else if (state.s < 0) state.s = Math.min(0, state.s + ticks);
  }

  private openPage(page: Page, sel: number, s: number): void {
    state.page = page;
    state.sel = sel;
    state.s = s;
    this.app.input.consumeAction();
  }

  private toWheel(index: number): void {
    state.page = Page.Wheel;
    state.sel = index;
    state.target = index * STEP;
    state.s = 25; // makes the wheel snap to the target on the next frame
    this.app.input.releaseAll();
  }

  render(renderer: THREE.WebGLRenderer): void {
    this.view.lights.specularOn.value = this.app.specular > 0;
    this.view.update(state.camZ, state.current, state.clockMs, this.waveMs0);
    renderer.render(this.view.scene, this.view.camera);
    this.drawText();
  }

  private drawText(): void {
    if (state.camZ <= FADE_START) return;
    const f = (state.camZ - FADE_START) / 30;
    const text = this.app.text;
    const color = (c: RGB): RGB => [Math.trunc(c[0] * f), Math.trunc(c[1] * f), Math.trunc(c[2] * f)];
    const centred = (y: number, c: RGB, s: string) => text.draw(320 - measure(s, SIZE) * 0.5, y, color(c), SIZE, SIZE, s);

    if (state.page === Page.SingleMap || state.page === Page.TopScores) {
      const n = MAPS.length;
      const base = 444 + 4 * state.s - 17 * n;
      MAPS.forEach((slug, i) => {
        const label = state.page === Page.SingleMap ? displayName(slug) : (this.scores[i]?.text ?? displayName(slug));
        centred(base + ROW * (i - state.sel), i === state.sel ? RED : CYAN, label);
      });
    } else if (state.page === Page.Setup) {
      const s = this.app.settings;
      const lines = [`SPECULAR: ${SPECULAR[s.specular]}`, `ANTIALIAS: ${ANTIALIAS[s.antialias]}`, 'CHANGE CONTROLS'];
      lines.forEach((l, i) => centred(189 + ROW * i, i === state.sel ? RED : CYAN, l));
    } else if (state.page === Page.Controls) {
      CONTROL_LABELS.forEach((l, i) => {
        const c = i !== state.sel ? CYAN : this.capture ? GREEN : RED;
        centred(155 + ROW * i, c, `${l}${this.app.input.bindings[i]}`);
      });
    }
  }

  dispose(): void {
    this.view.dispose();
  }
}
