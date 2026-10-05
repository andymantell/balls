import { DEFAULT_KEYS } from './input';
import { Replay, parseRecord, type BestTime } from '../core/replay';
import { ASSET_ROOT, fetchBuffer } from '../render/assets';

/**
 * Persistent state. The original keeps setup.dat (specular, antialias),
 * keys.dat (virtual-key codes) and per-map maps/<name>.rec / .rep; here they
 * live in localStorage, seeded from the records shipped with the game.
 */

const PREFIX = 'balls.';

export interface Settings {
  /** 0 off, 1 on (normal), 2 on (DX6.1+AMD fixed). */
  specular: number;
  /** 0 off, 1 fullscene. */
  antialias: number;
  keys: number[];
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    /* storage unavailable (private mode etc.) */
  }
}

/** True until settings have been saved once; the menu then starts on SETUP. */
export function isFirstRun(): boolean {
  return read('setup') === null;
}

export function loadSettings(): Settings {
  const s: Settings = { specular: 0, antialias: 0, keys: [...DEFAULT_KEYS] };
  try {
    const setup = JSON.parse(read('setup') ?? 'null');
    if (setup) {
      s.specular = Math.max(0, Math.min(2, setup.specular | 0));
      s.antialias = Math.max(0, Math.min(1, setup.antialias | 0));
    }
    const keys = JSON.parse(read('keys') ?? 'null');
    if (Array.isArray(keys) && keys.length === 5 && keys.every((k) => Number.isInteger(k) && k > 0)) s.keys = keys;
  } catch {
    /* corrupt: defaults */
  }
  return s;
}

export function saveSettings(s: Settings): void {
  write('setup', JSON.stringify({ specular: s.specular, antialias: s.antialias }));
  write('keys', JSON.stringify(s.keys));
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): ArrayBuffer {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export interface MapRecord extends BestTime {
  replay: Replay | null;
}

/** Best times and replays per map slug. */
export class Records {
  private cache = new Map<string, MapRecord | null>();

  /** Best time for a map: the player's own if saved, otherwise the shipped .rec/.rep. */
  async get(slug: string): Promise<MapRecord | null> {
    if (this.cache.has(slug)) return this.cache.get(slug)!;
    let rec: MapRecord | null = null;
    try {
      const saved = JSON.parse(read(`rec.${slug}`) ?? 'null');
      if (saved && Number.isFinite(saved.timeMs)) {
        rec = { timeMs: saved.timeMs, name: String(saved.name ?? ''), replay: null };
        const rep = read(`rep.${slug}`);
        if (rep) rec.replay = Replay.parse(fromBase64(rep));
      }
    } catch {
      rec = null;
    }
    if (!rec) {
      try {
        const best = parseRecord(await fetchBuffer(`${ASSET_ROOT}maps/${slug}.rec`));
        if (best) {
          rec = { ...best, replay: null };
          try {
            rec.replay = Replay.parse(await fetchBuffer(`${ASSET_ROOT}maps/${slug}.rep`));
          } catch {
            /* no replay */
          }
        }
      } catch {
        rec = null;
      }
    }
    this.cache.set(slug, rec);
    return rec;
  }

  save(slug: string, timeMs: number, name: string, replay: Replay): void {
    write(`rec.${slug}`, JSON.stringify({ timeMs, name }));
    write(`rep.${slug}`, toBase64(replay.serialize()));
    this.cache.set(slug, { timeMs, name, replay });
  }
}
