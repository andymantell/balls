import * as THREE from 'three';
import type { MeshObject } from '../core/threeDo';
import { vertexNormals } from '../core/weld';

/**
 * Geometry of a .3DO object relative to its pivot in the port's mirrored space.
 * Vertex normals are the unweighted sum of all adjacent face normals,
 * normalised (0x402570), then averaged across welded seams (see weld.ts).
 */
export function buildGeometry(m: MeshObject): THREE.BufferGeometry {
  const nv = m.vertices.length / 3;
  const src = m.welded?.vertices ?? m.vertices;
  const P = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    P[i * 3] = Math.fround(src[i * 3] - m.pivot[0]);
    P[i * 3 + 1] = Math.fround(src[i * 3 + 1] - m.pivot[1]);
    P[i * 3 + 2] = -Math.fround(src[i * 3 + 2] - m.pivot[2]);
  }
  const fc = m.faces.length / 7;
  const N = m.welded?.normals ?? vertexNormals(m);
  const pos = new Float32Array(fc * 9);
  const nor = new Float32Array(fc * 9);
  const uv = new Float32Array(fc * 6);
  const nuv = m.uvs.length / 2;
  for (let f = 0; f < fc; f++) {
    // three.js treats counter-clockwise as front; the original's front side is
    // the side its normal points to, which in mirrored space means (a, c, b).
    const order = [0, 2, 1];
    for (let k = 0; k < 3; k++) {
      const corner = order[k];
      const v = m.faces[f * 7 + corner];
      const t = m.faces[f * 7 + 3 + corner];
      const o = (f * 3 + k) * 3;
      pos[o] = P[v * 3];
      pos[o + 1] = P[v * 3 + 1];
      pos[o + 2] = P[v * 3 + 2];
      nor[o] = N[v * 3];
      nor[o + 1] = N[v * 3 + 1];
      nor[o + 2] = N[v * 3 + 2];
      if (t >= 0 && t < nuv) {
        uv[(f * 3 + k) * 2] = m.uvs[t * 2];
        uv[(f * 3 + k) * 2 + 1] = m.uvs[t * 2 + 1];
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

/** Unit quad (-0.5..0.5) like the engine's 0x402980, facing +Z. */
export function unitQuad(uScale = 1, vScale = 1): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, vScale, uScale, vScale, uScale, 0, 0, 0]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
