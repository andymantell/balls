import * as THREE from 'three';
import { isLight, type ThreeDoFile } from '../core/threeDo';
import { fromPoint } from '../core/coords';
import type { TextureCache } from './assets';
import { createLightUniforms } from './d3dMaterial';
import { Model, setTransform } from './levelView';

const MODEL_SPIN = 0.0002;
const WAVE_AMPLITUDE = 16; // 0.008 / 0.0005
const WAVE_SPEED = 0.0005;
const WAVE_PHASE = 0.01;
const QUIT_COLUMN_END = 52; // menu.bmp: QUIT occupies texels x 5..44 of 256

/**
 * The main menu scene (menu.3DO, drawn by 0x40ed00): a textured sphere, the
 * SP5 wheel sphere carrying the five menu entries (rotated about X by the wheel
 * angle), a spinning lightning shell and the SP6 "BALLS" logo plane, whose
 * vertices ride a travelling wave. Camera at (0, 0, z) looking down +Z (D3D).
 */
export class MenuView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(89.95, 1, 1, 3000);
  readonly lights = createLightUniforms();
  private model!: Model;
  private wave: { pos: THREE.BufferAttribute; rest: Float32Array }[] = [];

  static async create(file: ThreeDoFile, textures: TextureCache): Promise<MenuView> {
    const v = new MenuView();
    v.model = await Model.build(file, textures, v.lights);
    v.model.addTo(v.scene, { opaque: 0, blended: 1000 });
    for (const p of v.model.parts) {
      if (p.special !== 6) continue;
      const pos = p.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      v.wave.push({ pos, rest: (pos.array as Float32Array).slice() });
    }
    // The browser port has no QUIT entry: black out its column on the wheel
    // texture (additive blending makes black invisible).
    for (const p of v.model.parts) {
      const map = p.material.uniforms.map.value as THREE.Texture | null;
      if (p.special !== 5 || !map) continue;
      const img = map.image as ImageBitmap;
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, Math.round((img.width * QUIT_COLUMN_END) / 256), img.height);
      const tex = map.clone();
      tex.image = canvas;
      tex.needsUpdate = true;
      p.material.uniforms.map.value = tex;
    }
    let n = 0;
    for (const r of file.points) {
      if (!isLight(r) || n >= 15) continue;
      const p = fromPoint(...r.position);
      v.lights.lightPos.value[n].set(p.x, p.y, p.z);
      v.lights.lightColor.value[n].setRGB(...r.color);
      v.lights.lightInvRange.value[n] = r.lightRange > 9999 ? 1e-6 : 1 / Math.max(r.lightRange, 1);
      n++;
    }
    v.lights.lightCount.value = n;
    return v;
  }

  /**
   * @param camZ  camera z in Direct3D space (0x423120)
   * @param wheel current wheel angle (0x913320)
   * @param ms    menu clock in milliseconds (0x52c810)
   * @param waveMs0 clock value when the logo started waving
   */
  update(camZ: number, wheel: number, ms: number, waveMs0: number): void {
    this.camera.position.set(0, 0, -camZ);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, -1000);
    this.camera.updateMatrixWorld();

    for (const p of this.model.parts) {
      const a = ms * MODEL_SPIN;
      const ax = p.special === 5 ? wheel : p.spin[0] * a;
      setTransform(p.mesh, p.pivot.x, p.pivot.y, p.pivot.z, ax, p.spin[1] * a, p.spin[2] * a);
    }

    // The original integrates x -= -0.008*dt*cos(phi), y/z -= -0.008*dt*sin(phi)
    // every frame (phi = 0.0005*ms + 0.01*(x0+y0+z0), rest coordinates in D3D
    // space); this is the closed form of that sum since the menu was loaded.
    for (const { pos, rest } of this.wave) {
      const out = pos.array as Float32Array;
      for (let i = 0; i < rest.length; i += 3) {
        const x0 = rest[i], y0 = rest[i + 1], z0 = -rest[i + 2];
        const k = WAVE_PHASE * (x0 + y0 + z0);
        const phi = WAVE_SPEED * ms + k, phi0 = WAVE_SPEED * waveMs0 + k;
        const dx = WAVE_AMPLITUDE * (Math.sin(phi) - Math.sin(phi0));
        const dyz = -WAVE_AMPLITUDE * (Math.cos(phi) - Math.cos(phi0));
        out[i] = x0 + dx;
        out[i + 1] = y0 + dyz;
        out[i + 2] = -(z0 + dyz);
      }
      pos.needsUpdate = true;
    }
  }

  dispose(): void {
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
