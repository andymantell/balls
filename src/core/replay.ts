import { Vec3 } from './vec3';
import { fromD3D, toD3D } from './coords';

/**
 * Original replay format (.rep): int32 tick count followed by one 28 byte record
 * per 16 ms tick: float pos[3], float vel[3] (Direct3D space), uint8 action key,
 * 3 pad bytes. Best times (.rec): int32 milliseconds + 3 initials.
 */
export const RECORD_SIZE = 28;

export class Replay {
  positions: Vec3[] = [];
  velocities: Vec3[] = [];
  actions: number[] = [];

  get length(): number {
    return this.positions.length;
  }

  push(pos: Vec3, vel: Vec3, action: boolean): void {
    if (this.length >= MAX_TICKS) return;
    this.positions.push(pos.clone());
    this.velocities.push(vel.clone());
    this.actions.push(action ? 1 : 0);
  }

  static parse(buffer: ArrayBuffer): Replay {
    const v = new DataView(buffer);
    const r = new Replay();
    let count = v.getInt32(0, true);
    count = Math.max(0, Math.min(count, Math.floor((buffer.byteLength - 4) / RECORD_SIZE)));
    let p = 4;
    for (let i = 0; i < count; i++, p += RECORD_SIZE) {
      const f = (o: number) => v.getFloat32(p + o, true);
      r.positions.push(fromD3D(f(0), f(4), f(8)));
      r.velocities.push(fromD3D(f(12), f(16), f(20)));
      r.actions.push(v.getUint8(p + 24));
    }
    return r;
  }

  serialize(): ArrayBuffer {
    const buf = new ArrayBuffer(4 + this.length * RECORD_SIZE);
    const v = new DataView(buf);
    v.setInt32(0, this.length, true);
    let p = 4;
    for (let i = 0; i < this.length; i++, p += RECORD_SIZE) {
      const pos = toD3D(this.positions[i]);
      const vel = toD3D(this.velocities[i]);
      [pos.x, pos.y, pos.z, vel.x, vel.y, vel.z].forEach((x, k) => v.setFloat32(p + k * 4, x, true));
      v.setUint8(p + 24, this.actions[i]);
    }
    return buf;
  }
}

/** The original's buffer holds 0x2A30 ticks (about 2 min 53 s). */
export const MAX_TICKS = 0x2a30;

export interface BestTime {
  timeMs: number;
  name: string;
}

export function parseRecord(buffer: ArrayBuffer): BestTime | null {
  if (buffer.byteLength < 7) return null;
  const v = new DataView(buffer);
  let name = '';
  for (let i = 4; i < 7; i++) {
    const c = v.getUint8(i);
    if (c) name += String.fromCharCode(c);
  }
  return { timeMs: v.getInt32(0, true), name };
}
