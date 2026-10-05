import * as THREE from 'three';
import { BlendMode } from '../core/threeDo';
import { MsvcRand } from '../core/rand';
import type { TextureCache } from './assets';
import { D3DMaterial, createLightUniforms } from './d3dMaterial';
import { setTransform } from './levelView';
import { unitQuad } from './meshBuilder';

const COUNT = 600;
const SCALE = 20;
const CAMERA_Z = -140; // 0x423124
const SPEED = 6; // per tick
const LEAD_EXTRA = 3; // the first sprite moves 9 per tick
const LEAD_STOP = -126;
const RESPAWN_Z = -200;
const LEAD_SPIN = 0.005; // radians per millisecond

/**
 * Shown after the twelfth level (state 3, 0x410000): 600 additive
 * "You've really got some BALLS" sprites (yrgsb.bmp) fly at the camera; the
 * first one spins in the middle of the screen and parks just in front of it.
 */
export class EndingView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(89.95, 1, 1, 3000);
  private meshes: THREE.Mesh[] = [];
  private x = new Float32Array(COUNT);
  private y = new Float32Array(COUNT);
  private z = new Float32Array(COUNT);
  private angle = new Float32Array(COUNT);
  private rand = new MsvcRand(1);

  static async create(textures: TextureCache): Promise<EndingView> {
    const v = new EndingView();
    const material = new D3DMaterial(createLightUniforms(), {
      diffuse: [0, 0, 0],
      emissive: [1, 1, 1],
      opacity: 1,
      blend: BlendMode.Additive,
      twoSided: true,
      map: await textures.get('yrgsb'),
    });
    const quad = unitQuad();
    for (let i = 0; i < COUNT; i++) {
      const mesh = new THREE.Mesh(quad, material);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = i;
      v.scene.add(mesh);
      v.meshes.push(mesh);
      v.respawn(i);
    }
    v.x[0] = 0;
    v.y[0] = 0;
    v.angle[0] = -Math.PI;
    v.camera.position.set(0, 0, -CAMERA_Z);
    v.camera.lookAt(0, 0, -1000);
    v.camera.updateMatrixWorld();
    return v;
  }

  private noise(): number {
    return this.rand.noise();
  }

  private respawn(i: number): void {
    this.z[i] = 1500 + 800 * this.noise();
    this.y[i] = 1000 * this.noise();
    this.x[i] = 1000 * this.noise();
    this.angle[i] = 2 * Math.PI * this.noise();
  }

  /** One frame of the original loop: `ticks` 16 ms steps, `dtMs` real time. */
  advance(ticks: number, dtMs: number): void {
    this.angle[0] -= dtMs * LEAD_SPIN;
    for (let i = 0; i < COUNT; i++) {
      this.z[i] -= SPEED * ticks;
      if (i === 0) {
        this.z[0] -= LEAD_EXTRA * ticks;
        if (this.z[0] < LEAD_STOP) this.z[0] = LEAD_STOP;
      }
      if (this.z[i] < RESPAWN_Z) this.respawn(i);
      setTransform(this.meshes[i], this.x[i], this.y[i], -this.z[i], 0, 0, this.angle[i], SCALE);
    }
  }

  dispose(): void {
    this.meshes[0]?.geometry.dispose();
    (this.meshes[0]?.material as THREE.Material | undefined)?.dispose();
  }
}
