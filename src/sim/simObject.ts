import { Vec3, rotationMatrix, mulMat3 } from '../core/vec3';
import { fromD3D } from '../core/coords';
import type { MeshObject } from '../core/threeDo';

export const SPIN_SCALE = 0.0032; // radians per tick per unit of ROX=/ROY=/ROZ=

export enum Special {
  Solid = 0,
  NoCollision = 1,
  GateNormal = 2,
  GateRed = 3,
  GateYellow = 4,
  GateBlue = 5,
  GateGreen = 6,
}

/** Collision/animation state of one mesh object; geometry relative to its pivot. */
export class SimObject {
  name: string;
  special: number;
  spinRate: Vec3;
  boost: Vec3;
  route: number;
  startRoutePoint: number;
  routePoint = 0;
  routeSpeed: number;
  wait = 0;
  routeVelocity = new Vec3();

  origin: Vec3;
  position = new Vec3();
  angles = new Vec3();
  prevPosition = new Vec3();
  prevAngles = new Vec3();

  /** Untransformed vertices relative to the pivot (Float64 xyz). */
  local: Float64Array;
  /** Rotated vertices relative to the pivot. */
  verts: Float64Array;
  prevVerts: Float64Array;
  indices: Int32Array;
  localNormals: Float64Array;
  normals: Float64Array;
  faceMin: Float64Array;
  faceMax: Float64Array;
  boundMin = new Vec3();
  boundMax = new Vec3();
  private appliedAngles = new Vec3(NaN, NaN, NaN);
  private rot = new Float64Array(9);

  constructor(m: MeshObject) {
    this.name = m.name;
    this.special = m.special;
    this.spinRate = new Vec3(m.spin[0] * SPIN_SCALE, m.spin[1] * SPIN_SCALE, m.spin[2] * SPIN_SCALE);
    this.boost = new Vec3(...m.boost);
    this.route = m.route;
    this.startRoutePoint = m.routePoint;
    this.routeSpeed = m.routeSpeed;
    this.origin = fromD3D(...m.pivot).f32();
    const n = m.vertices.length / 3;
    const toLocal = (src: Float32Array) => {
      const out = new Float64Array(n * 3);
      for (let i = 0; i < n; i++) {
        out[i * 3] = Math.fround(src[i * 3] - m.pivot[0]);
        out[i * 3 + 1] = Math.fround(src[i * 3 + 1] - m.pivot[1]);
        out[i * 3 + 2] = -Math.fround(src[i * 3 + 2] - m.pivot[2]);
      }
      return out;
    };
    // Collision faces use the welded positions but the pre-weld face normals.
    this.local = toLocal(m.welded?.vertices ?? m.vertices);
    const original = m.welded ? toLocal(m.vertices) : this.local;
    const fc = m.faces.length / 7;
    this.indices = new Int32Array(fc * 3);
    this.localNormals = new Float64Array(fc * 3);
    const L = original;
    for (let f = 0; f < fc; f++) {
      const a = m.faces[f * 7], b = m.faces[f * 7 + 1], c = m.faces[f * 7 + 2];
      this.indices[f * 3] = a;
      this.indices[f * 3 + 1] = b;
      this.indices[f * 3 + 2] = c;
      // The original computes (B-A)x(C-A) in its left-handed space; in the
      // mirrored space the physical normal is (C-A)x(B-A).
      const e1x = L[c * 3] - L[a * 3], e1y = L[c * 3 + 1] - L[a * 3 + 1], e1z = L[c * 3 + 2] - L[a * 3 + 2];
      const e2x = L[b * 3] - L[a * 3], e2y = L[b * 3 + 1] - L[a * 3 + 1], e2z = L[b * 3 + 2] - L[a * 3 + 2];
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len * len > 1e-10) {
        nx /= len;
        ny /= len;
        nz /= len;
      }
      this.localNormals[f * 3] = nx;
      this.localNormals[f * 3 + 1] = ny;
      this.localNormals[f * 3 + 2] = nz;
    }
    this.verts = new Float64Array(this.local);
    this.prevVerts = new Float64Array(this.local);
    this.normals = new Float64Array(this.localNormals);
    this.faceMin = new Float64Array(fc * 3);
    this.faceMax = new Float64Array(fc * 3);
    this.reset();
  }

  get faceCount(): number {
    return this.indices.length / 3;
  }

  isAnimated(): boolean {
    return !this.spinRate.isZero() || this.routeSpeed !== 0;
  }

  /** Ball type a gate turns the ball into, or -1. */
  gateBallType(): number {
    return this.special >= Special.GateNormal && this.special <= Special.GateGreen ? this.special - Special.GateNormal : -1;
  }

  reset(): void {
    this.position.copy(this.origin);
    this.prevPosition.copy(this.origin);
    this.angles.set(0, 0, 0);
    this.prevAngles.set(0, 0, 0);
    this.wait = 0;
    this.routePoint = this.startRoutePoint;
    this.routeVelocity.set(0, 0, 0);
    this.applyRotation(true);
    this.prevVerts.set(this.verts);
  }

  /** Recomputes rotated geometry and bounds when the orientation changed. */
  applyRotation(force = false): void {
    if (!force && this.angles.equals(this.appliedAngles)) return;
    this.appliedAngles.copy(this.angles);
    const m = rotationMatrix(this.angles.x, this.angles.y, this.angles.z, this.rot);
    const L = this.local, V = this.verts;
    const tmp = new Vec3();
    for (let i = 0; i < L.length; i += 3) {
      mulMat3(m, L[i], L[i + 1], L[i + 2], tmp);
      V[i] = Math.fround(tmp.x);
      V[i + 1] = Math.fround(tmp.y);
      V[i + 2] = Math.fround(tmp.z);
    }
    const LN = this.localNormals, N = this.normals;
    for (let i = 0; i < LN.length; i += 3) {
      mulMat3(m, LN[i], LN[i + 1], LN[i + 2], tmp);
      N[i] = tmp.x;
      N[i + 1] = tmp.y;
      N[i + 2] = tmp.z;
    }
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const I = this.indices;
    for (let f = 0; f < I.length / 3; f++) {
      let fx0 = Infinity, fy0 = Infinity, fz0 = Infinity, fx1 = -Infinity, fy1 = -Infinity, fz1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const v = I[f * 3 + k] * 3;
        const x = V[v], y = V[v + 1], z = V[v + 2];
        if (x < fx0) fx0 = x;
        if (x > fx1) fx1 = x;
        if (y < fy0) fy0 = y;
        if (y > fy1) fy1 = y;
        if (z < fz0) fz0 = z;
        if (z > fz1) fz1 = z;
      }
      this.faceMin[f * 3] = fx0;
      this.faceMin[f * 3 + 1] = fy0;
      this.faceMin[f * 3 + 2] = fz0;
      this.faceMax[f * 3] = fx1;
      this.faceMax[f * 3 + 1] = fy1;
      this.faceMax[f * 3 + 2] = fz1;
      if (fx0 < minX) minX = fx0;
      if (fy0 < minY) minY = fy0;
      if (fz0 < minZ) minZ = fz0;
      if (fx1 > maxX) maxX = fx1;
      if (fy1 > maxY) maxY = fy1;
      if (fz1 > maxZ) maxZ = fz1;
    }
    if (I.length === 0) {
      minX = minY = minZ = maxX = maxY = maxZ = 0;
    }
    this.boundMin.set(minX, minY, minZ);
    this.boundMax.set(maxX, maxY, maxZ);
  }
}
