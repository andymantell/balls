import type { MeshObject } from './threeDo';

const F = Math.fround;
const WELD_DISTANCE = 3; // Manhattan distance, 0x420020

/**
 * Per-vertex normals as the engine computes them at load (0x402570): the
 * normalised, unweighted sum of the adjacent face normals. Returned in the
 * port's mirrored space (z negated).
 */
export function vertexNormals(m: MeshObject): Float32Array {
  const nv = m.vertices.length / 3;
  const P = new Float64Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    P[i * 3] = F(m.vertices[i * 3] - m.pivot[0]);
    P[i * 3 + 1] = F(m.vertices[i * 3 + 1] - m.pivot[1]);
    P[i * 3 + 2] = -F(m.vertices[i * 3 + 2] - m.pivot[2]);
  }
  const N = new Float32Array(nv * 3);
  const fc = m.faces.length / 7;
  for (let f = 0; f < fc; f++) {
    const a = m.faces[f * 7], b = m.faces[f * 7 + 1], c = m.faces[f * 7 + 2];
    if (a >= nv || b >= nv || c >= nv) continue;
    const e1x = P[c * 3] - P[a * 3], e1y = P[c * 3 + 1] - P[a * 3 + 1], e1z = P[c * 3 + 2] - P[a * 3 + 2];
    const e2x = P[b * 3] - P[a * 3], e2y = P[b * 3 + 1] - P[a * 3 + 1], e2z = P[b * 3 + 2] - P[a * 3 + 2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (len * len > 1e-10) {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    for (const v of [a, b, c]) {
      N[v * 3] += nx;
      N[v * 3 + 1] += ny;
      N[v * 3 + 2] += nz;
    }
  }
  for (let i = 0; i < nv; i++) {
    const len = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
    if (len * len > 1e-10) {
      N[i * 3] /= len;
      N[i * 3 + 1] /= len;
      N[i * 3 + 2] /= len;
    }
  }
  return N;
}

/**
 * The loader's seam welding (0x403340), run once after a file is loaded:
 * for every pair of different objects with the same texture name that neither
 * spin (ROX/ROY/ROZ) nor travel a route (SPD), any two vertices closer than 3
 * units (|dx|+|dy|+|dz|) are both moved to their midpoint, and their vertex
 * normals become the average of the two (not renormalised). This is the
 * changelog's "no holes between the objects". It can tilt large faces
 * slightly, which the shipped replays (castle) depend on.
 *
 * Face normals used for collisions were computed before welding and are not
 * updated, so `vertices` stays untouched and the result goes to `welded`.
 */
export function weldObjects(objects: MeshObject[]): void {
  const isStatic = (m: MeshObject) => m.spin.every((s) => s === 0) && m.routeSpeed === 0;
  // Pivot-relative float vertices and the pivot, like the engine's object records.
  const local = objects.map((m) => {
    const n = m.vertices.length / 3;
    const L = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) L[i * 3 + k] = F(m.vertices[i * 3 + k] - m.pivot[k]);
    return L;
  });
  const pos = objects.map((m) => m.pivot.map(F));
  const normals = objects.map((m) => {
    // Work in Direct3D space (z not mirrored), convert back at the end.
    const N = vertexNormals(m);
    for (let i = 2; i < N.length; i += 3) N[i] = -N[i];
    return N;
  });
  let changed = false;
  for (let A = 0; A < objects.length; A++) {
    const ma = objects[A];
    const la = local[A], pa = pos[A], na = normals[A];
    for (let i = 0; i < la.length; i += 3) {
      for (let B = 0; B < objects.length; B++) {
        if (A === B) continue;
        const mb = objects[B];
        if (ma.texture !== mb.texture || !isStatic(ma) || !isStatic(mb)) continue;
        const lb = local[B], pb = pos[B], nb = normals[B];
        for (let j = 0; j < lb.length; j += 3) {
          const d =
            F(F(Math.abs(F(F(lb[j] + pb[0]) - F(la[i] + pa[0]))) + Math.abs(F(F(lb[j + 1] + pb[1]) - F(la[i + 1] + pa[1])))) +
              Math.abs(F(F(lb[j + 2] + pb[2]) - F(la[i + 2] + pa[2]))));
          if (!(d < WELD_DISTANCE)) continue;
          for (let k = 0; k < 3; k++) {
            const mid = F(F(F(F(lb[j + k] + la[i + k]) + pb[k]) + pa[k]) * 0.5);
            la[i + k] = F(mid - pa[k]);
            lb[j + k] = F(mid - pb[k]);
            const n = F(F(nb[j + k] + na[i + k]) * 0.5);
            na[i + k] = n;
            nb[j + k] = n;
          }
          changed = true;
        }
      }
    }
  }
  if (!changed) return;
  objects.forEach((m, o) => {
    const L = local[o], N = normals[o];
    const vertices = new Float32Array(L.length);
    for (let i = 0; i < L.length; i += 3) {
      for (let k = 0; k < 3; k++) vertices[i + k] = F(L[i + k] + pos[o][k]);
      N[i + 2] = -N[i + 2];
    }
    m.welded = { vertices, normals: N };
  });
}
