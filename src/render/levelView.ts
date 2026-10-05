import * as THREE from 'three';
import { BlendMode, isLight, type MeshObject, type ThreeDoFile } from '../core/threeDo';
import { rotationMatrix } from '../core/vec3';
import { fromD3D } from '../core/coords';
import { BALL_GLOW, BallType, type World } from '../sim/world';
import { Special } from '../sim/simObject';
import { loadModel, type TextureCache } from './assets';
import { D3DMaterial, MAX_LIGHTS, createLightUniforms, materialParams, type LightUniforms } from './d3dMaterial';
import { buildGeometry, unitQuad } from './meshBuilder';
import { MsvcRand } from '../core/rand';

const FAR = 3000;
const HUGE_RANGE = 9999;
const MODEL_SPIN = 0.0002; // radians per ms per unit of ROX=/ROY=/ROZ= for decorative models
const GLOW_SCALE = 25;

const _m = new THREE.Matrix4();
const _r = new Float64Array(9);

/** Sets a mesh's matrix to translate * engine-rotation * scale. */
export function setTransform(obj: THREE.Object3D, x: number, y: number, z: number, ax: number, ay: number, az: number, s = 1): void {
  const r = rotationMatrix(ax, ay, az, _r);
  obj.matrix.set(r[0] * s, r[1] * s, r[2] * s, x, r[3] * s, r[4] * s, r[5] * s, y, r[6] * s, r[7] * s, r[8] * s, z, 0, 0, 0, 1);
  obj.matrixWorldNeedsUpdate = true;
}

interface ModelPart {
  mesh: THREE.Mesh;
  material: D3DMaterial;
  spin: [number, number, number];
  special: number;
  pivot: THREE.Vector3;
}

/** A .3DO model (ball, diamond, menu) built from D3D materials. */
export class Model {
  readonly parts: ModelPart[] = [];
  constructor(readonly file: ThreeDoFile) {}

  static async build(file: ThreeDoFile, textures: TextureCache, lights: LightUniforms): Promise<Model> {
    const model = new Model(file);
    for (const m of file.objects) {
      if (!m.texture) continue; // untextured objects are never drawn by the engine
      const material = new D3DMaterial(lights, materialParams(m, await textures.get(m.texture)));
      const mesh = new THREE.Mesh(buildGeometry(m), material);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      model.parts.push({ mesh, material, spin: m.spin, special: m.special, pivot: fromD3D(...m.pivot) as unknown as THREE.Vector3 });
    }
    return model;
  }

  addTo(scene: THREE.Object3D, order: { opaque: number; blended: number }): void {
    for (const p of this.parts) {
      p.mesh.renderOrder = p.material.blended ? order.blended++ : order.opaque;
      scene.add(p.mesh);
    }
  }

  set visible(v: boolean) {
    for (const p of this.parts) p.mesh.visible = v;
  }

  /** Places every part at (x,y,z) + its pivot, spinning with the level clock. */
  place(x: number, y: number, z: number, timeMs: number, scale = 1): void {
    for (const p of this.parts) {
      const a = timeMs * MODEL_SPIN;
      setTransform(p.mesh, x + p.pivot.x, y + p.pivot.y, z + p.pivot.z, p.spin[0] * a, p.spin[1] * a, p.spin[2] * a, scale);
    }
  }
}

interface LightSource {
  pointIndex: number;
  color: [number, number, number];
  range: number;
  glow: number;
  glowMeshes: THREE.Mesh[];
}

export class LevelView {
  readonly scene = new THREE.Scene();
  /** D3DUtil_SetProjectionMatrix(1.57, aspect 1.0, 1, 3000): 90 degrees, stretched to the 4:3 screen. */
  readonly camera = new THREE.PerspectiveCamera(89.95, 1, 1, FAR);
  readonly lights = createLightUniforms();
  background: THREE.Texture | null = null;

  private objectMeshes: (THREE.Mesh | null)[] = [];
  private ball!: Model;
  private blueBall!: Model;
  private shadows: Model[] = [];
  private diamonds: Model[] = [];
  private particles: { mesh: THREE.Mesh; material: D3DMaterial }[] = [];
  private lightSources: LightSource[] = [];
  private zap!: THREE.Mesh;
  private zapMaterial!: D3DMaterial;
  private order = { opaque: 0, blended: 1000 };
  /** Lightning jitter uses its own generator so drawing never perturbs the simulation. */
  private fxRand = new MsvcRand(1);

  constructor(readonly world: World) {
    this.scene.matrixWorldAutoUpdate = true;
  }

  static async create(file: ThreeDoFile, world: World, textures: TextureCache): Promise<LevelView> {
    const v = new LevelView(world);
    await v.build(file, textures);
    return v;
  }

  private async build(file: ThreeDoFile, textures: TextureCache): Promise<void> {
    this.background = await textures.get(file.background);
    for (const m of file.objects) this.objectMeshes.push(await this.levelMesh(m, textures));

    const [ballFile, blueFile, diaFile] = await Promise.all([loadModel('ball'), loadModel('ball2'), loadModel('dia')]);
    this.ball = await Model.build(ballFile, textures, this.lights);
    this.blueBall = await Model.build(blueFile, textures, this.lights);
    for (const model of [this.ball, this.blueBall]) {
      // SP5 in the ball models is the shadow plane, positioned separately.
      const shadow = new Model(model.file);
      shadow.parts.push(...model.parts.filter((p) => p.special === Special.GateBlue));
      model.parts.splice(0, model.parts.length, ...model.parts.filter((p) => p.special !== Special.GateBlue));
      this.shadows.push(shadow);
    }
    for (let i = 0; i < this.world.diamonds.length; i++) this.diamonds.push(await Model.build(diaFile, textures, this.lights));

    // Draw order follows the engine: level, ball, diamonds; opaque first, then
    // blended objects in the same order, then effects.
    for (const mesh of this.objectMeshes) if (mesh) this.add(mesh);
    this.ball.addTo(this.scene, this.order);
    this.blueBall.addTo(this.scene, this.order);
    for (const s of this.shadows) s.addTo(this.scene, this.order);
    for (const d of this.diamonds) d.addTo(this.scene, this.order);

    const bang = await textures.get('bang');
    const quad = unitQuad(0.25, 0.125);
    for (let i = 0; i < this.world.particles.length; i++) {
      const material = this.effectMaterial(bang);
      const mesh = new THREE.Mesh(quad, material);
      this.add(mesh);
      this.particles.push({ mesh, material });
    }

    this.zapMaterial = this.effectMaterial(await textures.get('salama'));
    const zg = new THREE.BufferGeometry();
    zg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    zg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    zg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 0.5]), 2));
    this.zap = new THREE.Mesh(zg, this.zapMaterial);
    this.zap.matrixAutoUpdate = false;
    this.add(this.zap);

    const flare = await textures.get('flare');
    const glowQuad = unitQuad();
    file.points.forEach((r, i) => {
      if (!isLight(r)) return;
      const glowMeshes: THREE.Mesh[] = [];
      if (r.glow > 0) {
        for (const color of [r.color, [1, 1, 1] as [number, number, number]]) {
          const mat = this.effectMaterial(flare);
          mat.emissiveColor.setRGB(...color);
          const mesh = new THREE.Mesh(glowQuad, mat);
          this.add(mesh);
          glowMeshes.push(mesh);
        }
      }
      this.lightSources.push({
        pointIndex: i,
        color: r.color,
        range: r.lightRange > HUGE_RANGE ? 1e6 : Math.max(r.lightRange, 1),
        glow: r.glow,
        glowMeshes,
      });
    });
  }

  private add(mesh: THREE.Mesh): void {
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = (mesh.material as D3DMaterial).blended ? this.order.blended++ : this.order.opaque;
    this.scene.add(mesh);
  }

  private async levelMesh(m: MeshObject, textures: TextureCache): Promise<THREE.Mesh | null> {
    if (!m.texture) return null;
    const material = new D3DMaterial(this.lights, materialParams(m, await textures.get(m.texture)));
    return new THREE.Mesh(buildGeometry(m), material);
  }

  /** Effect quads: additive, two-sided, black diffuse, emissive colour (0x402f40). */
  private effectMaterial(map: THREE.Texture | null): D3DMaterial {
    return new D3DMaterial(this.lights, { diffuse: [0, 0, 0], emissive: [1, 1, 1], opacity: 1, blend: BlendMode.Additive, twoSided: true, map });
  }

  /** Updates everything for a frame interpolated `alpha` between the last two ticks. */
  update(alpha: number, timeMs: number): void {
    const w = this.world;
    const lerp = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
      new THREE.Vector3(a.x + (b.x - a.x) * alpha, a.y + (b.y - a.y) * alpha, a.z + (b.z - a.z) * alpha);

    // Camera: eye = camera point (+100 up in camera mode 1), looking at the ball.
    const ball = lerp(w.prevPosition, w.position);
    const eye = lerp(w.prevCamera, w.camera);
    eye.y += 100 * w.cameraMode;
    this.camera.position.copy(eye);
    this.camera.up.set(0, 1, 0);
    if (eye.distanceToSquared(ball) > 1e-6) this.camera.lookAt(ball);
    this.camera.updateMatrixWorld();

    w.objects.forEach((o, i) => {
      const mesh = this.objectMeshes[i];
      if (!mesh) return;
      const p = lerp(o.prevPosition, o.position);
      const da = Math.abs(o.angles.x - o.prevAngles.x) + Math.abs(o.angles.y - o.prevAngles.y) + Math.abs(o.angles.z - o.prevAngles.z);
      const t = da < Math.PI ? alpha : 1;
      setTransform(mesh, p.x, p.y, p.z,
        o.prevAngles.x + (o.angles.x - o.prevAngles.x) * t,
        o.prevAngles.y + (o.angles.y - o.prevAngles.y) * t,
        o.prevAngles.z + (o.angles.z - o.prevAngles.z) * t);
    });

    // Lights (D3D point lights) including the ball's own light.
    const L = this.lights;
    let n = 0;
    for (const s of this.lightSources) {
      if (n >= MAX_LIGHTS - 1) break;
      const pt = w.points[s.pointIndex];
      const pos = lerp(pt.prevPosition, pt.position);
      L.lightPos.value[n].copy(pos);
      L.lightColor.value[n].setRGB(...s.color);
      L.lightInvRange.value[n] = 1 / s.range;
      n++;
      for (const g of s.glowMeshes) this.billboard(g, pos, s.glow * GLOW_SCALE, 0);
    }
    L.lightPos.value[n].copy(ball);
    L.lightColor.value[n].setRGB(...w.ballLight.color);
    L.lightInvRange.value[n] = 1 / Math.max(w.ballLight.range, 1);
    n++;
    L.lightCount.value = n;

    // Ball (does not roll; its decorative parts spin with the level clock).
    const blue = w.ballType === BallType.Blue;
    this.ball.visible = !blue;
    this.blueBall.visible = blue;
    this.shadows[0].visible = !blue;
    this.shadows[1].visible = blue;
    const model = blue ? this.blueBall : this.ball;
    model.place(ball.x, ball.y, ball.z, timeMs);
    for (const p of model.parts) p.material.emissiveColor.setRGB(...BALL_GLOW[w.ballType]);
    const shadowDist = w.shadowDistance();
    (blue ? this.shadows[1] : this.shadows[0]).place(ball.x, ball.y - shadowDist, ball.z, 0);

    w.diamonds.forEach((d, i) => {
      const model = this.diamonds[i];
      model.visible = d.alive;
      if (!d.alive) return;
      const p = lerp(d.prevPosition, d.position);
      model.place(p.x, p.y, p.z, timeMs, d.fade > 0 ? d.fade : 1);
    });

    w.particles.forEach((p, i) => {
      const { mesh, material } = this.particles[i];
      mesh.visible = p.alive;
      if (!p.alive) return;
      material.emissiveColor.setRGB(...p.color);
      const frame = Math.trunc(p.age);
      material.uvOffset.set(Math.trunc(frame / 8) * 0.25, (frame % 8) * 0.125);
      this.billboard(mesh, lerp(p.prevPosition, p.position), p.size, p.roll);
    });

    this.zap.visible = w.zapTimer > 0 && blue;
    if (this.zap.visible) {
      const a = this.zap.geometry.getAttribute('position') as THREE.BufferAttribute;
      const r = this.fxRand;
      a.setXYZ(0, ball.x + 20 * r.noise(), ball.y, ball.z + 20 * r.noise());
      a.setXYZ(1, ball.x + 20 * r.noise(), ball.y, ball.z + 20 * r.noise());
      a.setXYZ(2, w.zapTarget.x, w.zapTarget.y, w.zapTarget.z);
      a.needsUpdate = true;
      this.zapMaterial.emissiveColor.setScalar(w.zapTimer * 0.05);
      this.zap.matrix.identity();
    }
  }

  private billboard(mesh: THREE.Object3D, pos: THREE.Vector3, size: number, roll: number): void {
    const q = this.camera.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
    _m.compose(pos, q, new THREE.Vector3(size, size, size));
    mesh.matrix.copy(_m);
    mesh.matrixWorldNeedsUpdate = true;
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
