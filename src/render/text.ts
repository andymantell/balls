import * as THREE from 'three';
import type { TextureCache } from './assets';

/**
 * The original text routine (0x406550): glyphs from ifont1-3.bmp (4 x 4 cells
 * of 64 px), drawn as additive quads in a 640 x 480 virtual screen, coloured by
 * vertex colour. Each glyph quad is `size` wide; the pen advances by
 * width_table[glyph] * size * 0.01796875, spaces by size / 2.
 */

const GLYPH_WIDTHS = [
  39, 38, 39, 38, 27, 29, 38, 39, 16, 24, 40, 28, 48, 37, 39, 37, // A-P
  36, 38, 37, 36, 35, 43, 62, 39, 37, 30, 38, 28, 35, 37, 38, 35, // Q-Z 0-5
  35, 30, 36, 38, 25, 31, 50, 19, 34, 13, 37, 21, 10, 53, 21, 21, // 6-9 : / % ! ? . + - , diamond ( )
];
const ADVANCE = 0.01796875;
const CELL_UV = 0.2421875;
export const DIAMOND_CHAR = '§';

export function glyphIndex(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c >= 0x30 && c <= 0x39) return c - 0x16;
  if (c >= 0x41 && c <= 0x5a) return c - 0x41;
  if (c >= 0x61 && c <= 0x7a) return c - 0x61;
  const special = ':/%!?.+-,§()';
  const i = special.indexOf(ch);
  return i >= 0 ? 36 + i : -1;
}

/** Width of a string as the original's measuring routine (0x406450) computes it. */
export function measure(text: string, size: number): number {
  let w = 0;
  for (const ch of text) {
    const g = glyphIndex(ch);
    w += g >= 0 ? GLYPH_WIDTHS[g] * size * ADVANCE : size * 0.5;
  }
  return w;
}

export type RGB = [number, number, number];

interface Pending {
  x: number;
  y: number;
  color: RGB;
  sx: number;
  sy: number;
  text: string;
}

export class TextLayer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(0, 640, 0, 480, -1, 1);
  private pages: THREE.Mesh[] = [];
  private pending: Pending[] = [];

  async init(textures: TextureCache): Promise<void> {
    for (let p = 0; p < 3; p++) {
      const map = await textures.get(`ifont${p + 1}`);
      const mat = new THREE.ShaderMaterial({
        uniforms: { map: { value: map } },
        vertexShader: `attribute vec3 color; varying vec2 vUv; varying vec3 vColor;
          void main() { vUv = uv; vColor = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying vec3 vColor;
          void main() { gl_FragColor = vec4(texture2D(map, vUv).rgb * vColor, 1.0); }`,
        transparent: true,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.frustumCulled = false;
      this.pages.push(mesh);
      this.scene.add(mesh);
    }
  }

  /** Queues a string; colours are 0..255 like the original's arguments. */
  draw(x: number, y: number, color: RGB, sx: number, sy: number, text: string): void {
    this.pending.push({ x, y, color, sx, sy, text: text.toUpperCase() });
  }

  /** Builds the geometry for everything queued since the last flush. */
  flush(): void {
    const data = this.pages.map(() => ({ pos: [] as number[], uv: [] as number[], col: [] as number[], idx: [] as number[] }));
    for (const t of this.pending) {
      let pen = t.x;
      const r = Math.max(0, Math.min(255, t.color[0])) / 255;
      const g = Math.max(0, Math.min(255, t.color[1])) / 255;
      const b = Math.max(0, Math.min(255, t.color[2])) / 255;
      for (const ch of t.text) {
        const gi = glyphIndex(ch);
        if (gi < 0) {
          pen += t.sx * 0.5;
          continue;
        }
        const d = data[Math.floor(gi / 16)];
        const cell = gi % 16;
        const u0 = (cell % 4) * 0.25, v0 = Math.floor(cell / 4) * 0.25;
        const base = d.pos.length / 3;
        d.pos.push(pen, t.y, 0, pen + t.sx, t.y, 0, pen + t.sx, t.y + t.sy, 0, pen, t.y + t.sy, 0);
        d.uv.push(u0, v0, u0 + CELL_UV, v0, u0 + CELL_UV, v0 + CELL_UV, u0, v0 + CELL_UV);
        for (let k = 0; k < 4; k++) d.col.push(r, g, b);
        d.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        pen += GLYPH_WIDTHS[gi] * t.sx * ADVANCE;
      }
    }
    this.pages.forEach((mesh, p) => {
      const d = data[p];
      const geo = mesh.geometry;
      geo.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(d.col, 3));
      geo.setIndex(d.idx);
      mesh.visible = d.idx.length > 0;
    });
    this.pending = [];
  }
}
