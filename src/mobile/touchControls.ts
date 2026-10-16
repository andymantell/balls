import type { App } from '../game/app';
import { Key, VK_ESCAPE } from '../game/input';

/**
 * On-screen controls for touch devices. Loaded only when the primary pointer
 * is coarse (or with ?touch), so desktop play is untouched.
 *
 * Everything feeds the same InputState the keyboard uses, by pressing and
 * releasing the bound virtual keys, so the game sees exactly what a keyboard
 * would send:
 *  - a floating stick on the left, snapped to the 8 key directions (the game
 *    only knows up/down/left/right, and its steering quirks depend on that);
 *  - an action button (the ACTION key: ability, menu select);
 *  - a pause/back button (ESC), with a button beside it that swaps the stick
 *    and buttons between the left and right thumbs;
 *  - the phone keyboard while a new record asks for initials.
 *
 * In landscape the controls sit in the black bars beside the 4:3 picture; in
 * portrait the picture moves to the top and the controls sit below it.
 */

const DEAD_ZONE = 14; // px of drag before the stick presses anything
const STICK_RADIUS = 56; // px the knob can travel
const LETTER_INTERVAL = 320; // ms between typed letters (the game takes one per 15 ticks)
const LETTER_HOLD = 110; // ms each letter key stays down
const MIN_BAR = 120; // px: narrower side bars put the controls over the picture instead

const CSS = `
.tc-zone { position: fixed; touch-action: none; -webkit-user-select: none; user-select: none; z-index: 2; }
.tc-stick-base, .tc-stick-knob { position: fixed; border-radius: 50%; pointer-events: none; z-index: 3;
  transform: translate(-50%, -50%); visibility: hidden; }
.tc-stick-base { width: ${STICK_RADIUS * 2}px; height: ${STICK_RADIUS * 2}px;
  border: 2px solid rgba(100, 255, 255, 0.45); background: rgba(100, 255, 255, 0.06); }
.tc-stick-knob { width: 46px; height: 46px; background: rgba(100, 255, 255, 0.5);
  box-shadow: 0 0 14px rgba(100, 255, 255, 0.6); }
.tc-stick-hint { position: fixed; z-index: 2; pointer-events: none; border-radius: 50%;
  border: 2px dashed rgba(100, 255, 255, 0.25); transform: translate(-50%, -50%);
  width: ${STICK_RADIUS * 2}px; height: ${STICK_RADIUS * 2}px; }
.tc-button { position: fixed; z-index: 2; touch-action: none; -webkit-user-select: none; user-select: none;
  border-radius: 50%; border: 2px solid rgba(100, 255, 255, 0.6); background: rgba(100, 255, 255, 0.1);
  color: rgb(100, 255, 255); display: grid; place-items: center;
  font: 700 15px/1 system-ui, sans-serif; letter-spacing: 0.08em; transform: translate(-50%, -50%); }
.tc-button.down { border-color: rgb(255, 100, 100); background: rgba(255, 100, 100, 0.25); color: rgb(255, 100, 100); }
.tc-action { width: 92px; height: 92px; }
.tc-pause { width: 50px; height: 50px; font-size: 13px; }
.tc-type { position: fixed; z-index: 4; left: 50%; transform: translateX(-50%); padding: 12px 20px;
  border-radius: 24px; border: 2px solid rgb(255, 100, 100); background: rgba(0, 0, 0, 0.7);
  color: rgb(255, 100, 100); font: 700 15px/1 system-ui, sans-serif; letter-spacing: 0.06em; }
.tc-text { position: fixed; left: 0; top: 0; width: 1px; height: 1px; opacity: 0; font-size: 16px; border: 0; padding: 0; }
.tc-probe { position: fixed; visibility: hidden; pointer-events: none;
  padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement = document.body): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

function place(e: HTMLElement, x: number, y: number, w?: number, h?: number): void {
  e.style.left = `${x}px`;
  e.style.top = `${y}px`;
  if (w !== undefined) e.style.width = `${w}px`;
  if (h !== undefined) e.style.height = `${h}px`;
}

export function installTouchControls(app: App): void {
  const input = app.input;
  const press = (k: Key) => input.keyDown(input.bindings[k]);
  const release = (k: Key) => input.keyUp(input.bindings[k]);

  // Page behaviour: no pinch zoom, scrolling, text selection or long-press menus.
  const viewport = document.querySelector('meta[name="viewport"]');
  viewport?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
  document.body.style.touchAction = 'none';
  document.body.style.setProperty('-webkit-user-select', 'none');
  document.body.style.userSelect = 'none';
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const hint = document.getElementById('hint');
  if (hint) hint.textContent = 'Drag on the stick side to roll. A = action and select, ❚❚ = back, ⇄ = swap sides. Tap to enable sound.';

  // ---- Stick ---------------------------------------------------------------
  const zone = el('div', 'tc-zone');
  const ghost = el('div', 'tc-stick-hint');
  const base = el('div', 'tc-stick-base');
  const knob = el('div', 'tc-stick-knob');
  let stickId: number | null = null;
  let ox = 0, oy = 0;
  const held = new Set<Key>();

  const setDirections = (next: Set<Key>) => {
    for (const k of held) if (!next.has(k)) release(k);
    for (const k of next) if (!held.has(k)) press(k);
    held.clear();
    for (const k of next) held.add(k);
  };

  /** 8-way snap: the original only has four keys and their diagonals. */
  const directions = (dx: number, dy: number): Set<Key> => {
    const out = new Set<Key>();
    if (Math.hypot(dx, dy) < DEAD_ZONE) return out;
    const sector = ((Math.round(Math.atan2(-dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
    if (sector === 1 || sector === 2 || sector === 3) out.add(Key.Up);
    if (sector === 5 || sector === 6 || sector === 7) out.add(Key.Down);
    if (sector === 3 || sector === 4 || sector === 5) out.add(Key.Left);
    if (sector === 7 || sector === 0 || sector === 1) out.add(Key.Right);
    return out;
  };

  const moveStick = (x: number, y: number) => {
    let dx = x - ox, dy = y - oy;
    setDirections(directions(dx, dy));
    const d = Math.hypot(dx, dy);
    if (d > STICK_RADIUS) {
      dx *= STICK_RADIUS / d;
      dy *= STICK_RADIUS / d;
    }
    place(knob, ox + dx, oy + dy);
  };

  const endStick = () => {
    stickId = null;
    setDirections(new Set());
    base.style.visibility = knob.style.visibility = 'hidden';
    ghost.style.visibility = 'visible';
  };

  zone.addEventListener('pointerdown', (e) => {
    if (stickId !== null) return;
    stickId = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    ox = e.clientX;
    oy = e.clientY;
    place(base, ox, oy);
    place(knob, ox, oy);
    base.style.visibility = knob.style.visibility = 'visible';
    ghost.style.visibility = 'hidden';
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickId) moveStick(e.clientX, e.clientY);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    zone.addEventListener(type, (e) => {
      if (e.pointerId === stickId) endStick();
    });
  }

  // ---- Buttons -------------------------------------------------------------
  const button = (cls: string, label: string, down: () => void, up: () => void) => {
    const b = el('div', `tc-button ${cls}`);
    b.textContent = label;
    let id: number | null = null;
    b.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId;
      b.setPointerCapture(e.pointerId);
      b.classList.add('down');
      down();
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      b.classList.remove('down');
      up();
    };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
    b.addEventListener('lostpointercapture', end);
    return b;
  };
  const action = button('tc-action', 'A', () => press(Key.Action), () => release(Key.Action));
  const pause = button('tc-pause', '❚❚', () => input.keyDown(VK_ESCAPE), () => input.keyUp(VK_ESCAPE));

  // ---- Initials via the phone keyboard -------------------------------------
  // Browsers only open the keyboard from a tap, so a prompt appears while the
  // game is asking for initials. Letters are fed one at a time, slowly enough
  // for the game's 15-tick key delay.
  const typeButton = el('button', 'tc-type');
  typeButton.type = 'button';
  typeButton.textContent = 'TAP TO TYPE YOUR INITIALS';
  typeButton.style.display = 'none';
  const text = el('input', 'tc-text');
  text.type = 'text';
  text.autocomplete = 'off';
  text.setAttribute('autocapitalize', 'characters');
  text.setAttribute('autocorrect', 'off');
  text.spellcheck = false;
  const queue: number[] = [];
  let lastLetter = 0;
  typeButton.addEventListener('click', () => text.focus());
  text.addEventListener('input', () => {
    for (const ch of text.value.toUpperCase()) if (ch >= 'A' && ch <= 'Z') queue.push(ch.charCodeAt(0));
    text.value = '';
  });

  const feedLetters = (now: number) => {
    const wanted = app.wantsTextInput();
    typeButton.style.display = wanted && document.activeElement !== text ? 'block' : 'none';
    if (!wanted) {
      queue.length = 0;
      if (document.activeElement === text) text.blur();
      return;
    }
    if (queue.length && now - lastLetter >= LETTER_INTERVAL) {
      const vk = queue.shift()!;
      lastLetter = now;
      input.keyDown(vk);
      setTimeout(() => input.keyUp(vk), LETTER_HOLD);
    }
  };
  const tick = (now: number) => {
    feedLetters(now);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // ---- Layout --------------------------------------------------------------
  const probe = el('div', 'tc-probe');
  const insets = () => {
    const s = getComputedStyle(probe);
    return { top: parseFloat(s.paddingTop) || 0, right: parseFloat(s.paddingRight) || 0, bottom: parseFloat(s.paddingBottom) || 0, left: parseFloat(s.paddingLeft) || 0 };
  };

  // Left- or right-handed: the stick and the buttons swap sides (remembered per device).
  const FLIP_KEY = 'balls.touch.flipped';
  let flipped = false;
  try {
    flipped = localStorage.getItem(FLIP_KEY) === '1';
  } catch {
    /* storage unavailable */
  }
  const swap = el('div', 'tc-button tc-pause tc-swap');
  swap.textContent = '⇄';
  swap.setAttribute('aria-label', 'Swap controls between left and right');
  swap.addEventListener('pointerdown', () => swap.classList.add('down'));
  swap.addEventListener('pointercancel', () => swap.classList.remove('down'));
  swap.addEventListener('pointerup', () => {
    swap.classList.remove('down');
    flipped = !flipped;
    try {
      localStorage.setItem(FLIP_KEY, flipped ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    if (stickId !== null) endStick();
    layout();
  });

  const layout = () => {
    const W = window.innerWidth, H = window.innerHeight;
    const portrait = H > W;
    if (app.pictureAtTop !== portrait) {
      app.pictureAtTop = portrait;
      app.relayout();
    }
    const pic = app.pictureRect;
    const inset = insets();
    // Laid out for a left-thumb stick, then mirrored when flipped.
    const stickInset = flipped ? inset.right : inset.left;
    const buttonInset = flipped ? inset.left : inset.right;
    const mx = (x: number, w = 0) => (flipped ? W - x - w : x);
    const put = (e: HTMLElement, x: number, y: number, w?: number, h?: number) => place(e, mx(x, w ?? 0), y, w, h);
    if (portrait) {
      // Controls fill the space under the picture.
      const top = pic.y + pic.height;
      const h = H - top - inset.bottom;
      put(zone, 0, top, W / 2, H - top);
      put(ghost, W * 0.25, top + h / 2);
      put(action, W * 0.75, top + h / 2);
      const pauseX = W - 34 - buttonInset;
      put(pause, pauseX, top + 34);
      put(swap, pauseX - 62, top + 34);
      typeButton.style.top = `${top + 12}px`;
    } else {
      const bar = pic.x;
      const wide = bar >= MIN_BAR;
      // Side bars when there's room for them, otherwise over the picture's lower corners.
      const leftW = wide ? bar : W * 0.35;
      put(zone, 0, wide ? 0 : H * 0.4, leftW, wide ? H : H * 0.6);
      put(ghost, Math.max(stickInset + STICK_RADIUS + 8, leftW / 2), H * 0.68);
      const rightX = wide ? W - bar / 2 : W - 70 - buttonInset;
      put(action, Math.min(rightX, W - buttonInset - 54), H * 0.68);
      const pauseX = wide ? Math.min(W - bar / 2, W - buttonInset - 34) : W - 34 - buttonInset;
      const pauseY = 34 + inset.top;
      put(pause, pauseX, pauseY);
      if (wide) put(swap, pauseX, pauseY + 62);
      else put(swap, pauseX - 62, pauseY);
      typeButton.style.top = `${pic.y + pic.height * 0.62}px`;
    }
  };
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => setTimeout(layout, 250));
  layout();

  // Lifting every finger (or leaving the page) releases everything held.
  window.addEventListener('blur', () => {
    endStick();
    input.keyUp(input.bindings[Key.Action]);
  });
}
