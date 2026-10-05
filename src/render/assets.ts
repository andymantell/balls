import * as THREE from 'three';
import { parseThreeDo, type ThreeDoFile } from '../core/threeDo';

export const ASSET_ROOT = `${import.meta.env.BASE_URL}assets/`;

/**
 * Textures behave like Direct3D 6 surfaces: UV (0,0) is the top-left texel,
 * bilinear filtering without mipmaps, wrapping, and no colour management.
 */
export class TextureCache {
  private cache = new Map<string, Promise<THREE.Texture | null>>();
  private loader = new THREE.ImageBitmapLoader();
  /** Optional user-supplied files (custom levels), keyed by lowercase base name. */
  extra = new Map<string, Blob>();
  mipmaps = false;

  constructor() {
    this.loader.setOptions({ imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  }

  get(name: string): Promise<THREE.Texture | null> {
    const key = name.replace(/\.[^.]*$/, '').toLowerCase();
    if (!key) return Promise.resolve(null);
    let p = this.cache.get(key);
    if (!p) {
      p = this.load(key);
      this.cache.set(key, p);
    }
    return p;
  }

  private async load(key: string): Promise<THREE.Texture | null> {
    try {
      const blob = this.extra.get(key);
      const bitmap = blob
        ? await createImageBitmap(blob, { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
        : await this.loader.loadAsync(`${ASSET_ROOT}textures/${key}.png`);
      const tex = new THREE.Texture(bitmap as unknown as HTMLImageElement);
      tex.flipY = false;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = this.mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
      tex.generateMipmaps = this.mipmaps;
      tex.colorSpace = THREE.NoColorSpace;
      tex.needsUpdate = true;
      return tex;
    } catch {
      console.warn(`Texture ${key} not found`);
      return null;
    }
  }
}

export async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.arrayBuffer();
}

export async function loadModel(name: string): Promise<ThreeDoFile> {
  return parseThreeDo(await fetchBuffer(`${ASSET_ROOT}models/${name}.3do`), name);
}
