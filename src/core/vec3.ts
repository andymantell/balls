/** Minimal mutable 3D vector used by the simulation (kept free of three.js). */
export class Vec3 {
  constructor(public x = 0, public y = 0, public z = 0) {}

  static from(v: { x: number; y: number; z: number }): Vec3 {
    return new Vec3(v.x, v.y, v.z);
  }

  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v: Vec3): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  add(v: Vec3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  sub(v: Vec3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  addScaled(v: Vec3, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  distanceTo(v: Vec3): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  dot(v: Vec3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  /** Rounds every component to float32, like the original's x87 stores. */
  f32(): this {
    this.x = Math.fround(this.x);
    this.y = Math.fround(this.y);
    this.z = Math.fround(this.z);
    return this;
  }

  get(axis: number): number {
    return axis === 0 ? this.x : axis === 1 ? this.y : this.z;
  }

  setAxis(axis: number, value: number): void {
    if (axis === 0) this.x = value;
    else if (axis === 1) this.y = value;
    else this.z = value;
  }

  equals(v: Vec3): boolean {
    return this.x === v.x && this.y === v.y && this.z === v.z;
  }

  isZero(): boolean {
    return this.x === 0 && this.y === 0 && this.z === 0;
  }
}

/** 3x3 rotation matrix stored row-major. */
export type Mat3 = Float64Array;

/**
 * The engine's object orientation: radians around the Direct3D X, Y and Z axes,
 * applied Z first, then X, then Y (reverse engineered from 0x401180).
 * Returned matrix acts in the port's mirrored (right-handed) space, where the
 * X and Y rotations change sign.
 */
export function rotationMatrix(ax: number, ay: number, az: number, out: Mat3 = new Float64Array(9)): Mat3 {
  // Godot/three space: R = Ry(-ay) * Rx(-ax) * Rz(az)
  const cx = Math.cos(-ax), sx = Math.sin(-ax);
  const cy = Math.cos(-ay), sy = Math.sin(-ay);
  const cz = Math.cos(az), sz = Math.sin(az);
  // Rz
  const z00 = cz, z01 = -sz, z10 = sz, z11 = cz;
  // Rx * Rz
  const m00 = z00, m01 = z01, m02 = 0;
  const m10 = cx * z10, m11 = cx * z11, m12 = -sx;
  const m20 = sx * z10, m21 = sx * z11, m22 = cx;
  // Ry * (Rx * Rz)
  out[0] = cy * m00 + sy * m20;
  out[1] = cy * m01 + sy * m21;
  out[2] = cy * m02 + sy * m22;
  out[3] = m10;
  out[4] = m11;
  out[5] = m12;
  out[6] = -sy * m00 + cy * m20;
  out[7] = -sy * m01 + cy * m21;
  out[8] = -sy * m02 + cy * m22;
  return out;
}

export function mulMat3(m: Mat3, x: number, y: number, z: number, out: Vec3): Vec3 {
  return out.set(m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z);
}
