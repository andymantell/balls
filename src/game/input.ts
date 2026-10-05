/**
 * Keyboard (and gamepad) input modelled on the original's window procedure
 * (0x406bd0): keys are Windows virtual-key codes, the five game keys set
 * level-style flags, and `lastKey` holds the most recent WM_KEYDOWN code until
 * any key is released.
 */

/** KeyboardEvent.code -> Windows virtual-key code. */
const VK_BY_CODE: Record<string, number> = {
  Backspace: 8, Tab: 9, Enter: 13, NumpadEnter: 13, ShiftLeft: 16, ShiftRight: 16,
  ControlLeft: 17, ControlRight: 17, AltLeft: 18, AltRight: 18, Pause: 19, CapsLock: 20,
  Escape: 27, Space: 32, PageUp: 33, PageDown: 34, End: 35, Home: 36,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Insert: 45, Delete: 46,
  NumpadMultiply: 106, NumpadAdd: 107, NumpadSubtract: 109, NumpadDecimal: 110, NumpadDivide: 111,
  Semicolon: 186, Equal: 187, Comma: 188, Minus: 189, Period: 190, Slash: 191, Backquote: 192,
  BracketLeft: 219, Backslash: 220, BracketRight: 221, Quote: 222, IntlBackslash: 226,
};
for (let i = 0; i < 26; i++) VK_BY_CODE[`Key${String.fromCharCode(65 + i)}`] = 65 + i;
for (let i = 0; i < 10; i++) {
  VK_BY_CODE[`Digit${i}`] = 48 + i;
  VK_BY_CODE[`Numpad${i}`] = 96 + i;
}
for (let i = 1; i <= 12; i++) VK_BY_CODE[`F${i}`] = 111 + i;

export const VK_ESCAPE = 27;
export const VK_R = 0x52;

/** Defaults the game falls back to without keys.dat (0x406cb9): arrows + space. */
export const DEFAULT_KEYS = [38, 40, 37, 39, 32];

export enum Key {
  Up,
  Down,
  Left,
  Right,
  Action,
}

const GAMEPAD_VK = 0x10000; // pseudo key codes for gamepad buttons, never shown

export class InputState {
  /** Bound virtual-key codes for up, down, left, right, action. */
  bindings = [...DEFAULT_KEYS];
  /** Per-function flags (0x47d688..0x47d698). Cleared by menus to consume a press. */
  readonly flags = [false, false, false, false, false];
  /** Last WM_KEYDOWN code (0x5310b0), zeroed whenever any key goes up. */
  lastKey = 0;
  private held = new Set<number>();
  private padHeld = new Set<number>();

  attach(target: Window): void {
    target.addEventListener('keydown', (e) => {
      const vk = VK_BY_CODE[e.code];
      if (vk === undefined) return;
      if (vk === 9 || (vk >= 32 && vk <= 40) || vk === 18) e.preventDefault();
      this.keyDown(vk);
    });
    target.addEventListener('keyup', (e) => {
      const vk = VK_BY_CODE[e.code];
      if (vk === undefined) return;
      this.keyUp(vk);
    });
    target.addEventListener('blur', () => {
      for (const vk of [...this.held]) this.keyUp(vk);
    });
  }

  keyDown(vk: number): void {
    this.held.add(vk);
    this.lastKey = vk;
    this.bindings.forEach((b, i) => {
      if (b === vk) this.flags[i] = true;
    });
  }

  keyUp(vk: number): void {
    this.held.delete(vk);
    this.lastKey = 0;
    this.bindings.forEach((b, i) => {
      if (b === vk) this.flags[i] = false;
    });
  }

  get up(): boolean {
    return this.flags[Key.Up];
  }
  get down(): boolean {
    return this.flags[Key.Down];
  }
  get left(): boolean {
    return this.flags[Key.Left];
  }
  get right(): boolean {
    return this.flags[Key.Right];
  }
  get action(): boolean {
    return this.flags[Key.Action];
  }

  consumeAction(): void {
    this.flags[Key.Action] = false;
  }

  /** Releases everything (used when the page loses focus or a screen changes). */
  releaseAll(): void {
    this.flags.fill(false);
    this.lastKey = 0;
  }

  /**
   * Polls the first connected gamepad and feeds it through the same flags:
   * d-pad / left stick for directions, A (or X) for action, Start/B for ESC.
   */
  pollGamepad(): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected);
    const now = new Set<number>();
    if (pad) {
      const b = (i: number) => !!pad.buttons[i]?.pressed;
      const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
      if (b(12) || ay < -0.5) now.add(Key.Up);
      if (b(13) || ay > 0.5) now.add(Key.Down);
      if (b(14) || ax < -0.5) now.add(Key.Left);
      if (b(15) || ax > 0.5) now.add(Key.Right);
      if (b(0) || b(2)) now.add(Key.Action);
      if (b(9) || b(1)) now.add(GAMEPAD_VK + VK_ESCAPE);
      if (b(3)) now.add(GAMEPAD_VK + VK_R);
    }
    for (const k of now) {
      if (this.padHeld.has(k)) continue;
      if (k >= GAMEPAD_VK) this.lastKey = k - GAMEPAD_VK;
      else this.flags[k] = true;
    }
    for (const k of this.padHeld) {
      if (now.has(k)) continue;
      if (k >= GAMEPAD_VK) this.lastKey = 0;
      else if (!this.held.has(this.bindings[k])) this.flags[k] = false;
    }
    this.padHeld = now;
  }
}
