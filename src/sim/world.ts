import { Vec3 } from '../core/vec3';
import { fromPoint } from '../core/coords';
import { MsvcRand } from '../core/rand';
import { isHelper, type ThreeDoFile } from '../core/threeDo';
import { RouteTable, angleDelta, wrapAngle } from './routes';
import { SimObject, Special } from './simObject';

/**
 * Deterministic simulation of one level, reproducing BALLS.EXE v1.02 tick for
 * tick (fixed 16 ms ticks). Verified against the original best-time replays,
 * see tests/replay.test.ts and docs/REVERSE_ENGINEERING.md.
 */

export const TICK_MS = 16;
export const GRAVITY = 0.1;
export const ACCELERATION = 0.1;
export const DIAGONAL_FACTOR = 0.7;
export const AIR_DRAG = 0.996;
export const CONTACT_DRAG = 0.999;
export const BALL_RADIUS = 10;
export const BROADPHASE_MARGIN = 25;
export const MAX_CONTACTS = 50;
export const BOUNCE_SOFTEN = 0.8;
export const BOOST_SCALE = 0.04;
export const BOOST_DAMP = 0.86;
export const JUMP_SPEED = 5;
export const JUMP_COOLDOWN = 60;
export const GREEN_BRAKE = 0.9;
export const BLUE_ZAP_RANGE = 150;
export const ZAP_TICKS = 20;
export const DIAMOND_FADE = 0.05;
/** (ball model bbox 27 + diamond model bbox 44) / 3, integer maths as in the original. */
export const COLLECT_RADIUS = 23;
export const FALL_LIMIT = 100;
export const MAX_PARTICLES = 199;

export enum BallType {
  Normal = 0,
  Red = 1,
  Yellow = 2,
  Blue = 3,
  Green = 4,
}

/** Emissive ("ambient") colour the ball material gets per type. */
export const BALL_GLOW: ReadonlyArray<[number, number, number]> = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 0, 1],
  [0, 1, 0],
];

/** Sample played when the ball changes type, by type. */
export const TYPE_SOUND = ['bnormal', 'bred', 'byellow', 'bblue', 'bgreen'] as const;

export interface Input {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  action: boolean;
}

export const NO_INPUT: Input = { up: false, down: false, left: false, right: false, action: false };

/** A sound event: sample name, volume 0..63 and how many voices play it at once. */
export interface SoundEvent {
  sample: string;
  volume: number;
  count: number;
}

export class MovingPoint {
  position: Vec3;
  prevPosition: Vec3;
  point = 0;
  wait = 0;
  constructor(public origin: Vec3, public route: number, public startPoint: number, public speed: number) {
    this.position = origin.clone();
    this.prevPosition = origin.clone();
    this.reset();
  }
  reset(): void {
    this.position.copy(this.origin);
    this.prevPosition.copy(this.origin);
    this.point = this.startPoint;
    this.wait = 0;
  }
}

export class Diamond {
  /** 0 = present, >0 = shrinking away after being collected. */
  fade = 0;
  alive = true;
  position = new Vec3();
  prevPosition = new Vec3();
  constructor(public point: MovingPoint) {
    this.position.copy(point.position);
    this.prevPosition.copy(point.position);
  }
}

export class Particle {
  alive = false;
  position = new Vec3();
  prevPosition = new Vec3();
  velocity = new Vec3();
  age = 0;
  ageStep = 0;
  color: [number, number, number] = [1, 1, 1];
  size = 30;
  roll = 0;
  rollSpeed = 0;
}

interface Contact {
  object: SimObject;
  face: number;
  depth: number;
}

export interface LightState {
  range: number;
  color: [number, number, number];
}

export class World {
  /** Collision probe look-ahead (v1.0+: 1/3; replays from pre-release builds need 0.5 or 0). */
  lookahead = 1 / 3;
  /** Reproduce the original's "Right alone is 0.7x" steering quirk. */
  classicSteering = true;

  objects: SimObject[] = [];
  routes: RouteTable;
  points: MovingPoint[] = [];
  diamonds: Diamond[] = [];
  particles: Particle[] = [];
  startPosition = new Vec3();

  position = new Vec3();
  prevPosition = new Vec3();
  velocity = new Vec3();
  carry = new Vec3();
  ballType = BallType.Normal;
  private prevBallType = BallType.Normal;
  jumpTimer = 0;
  zapTimer = 0;
  zapTarget = new Vec3();
  contactCount = 0;
  ballLight: LightState = { range: 1, color: [0, 0, 0] };

  cameraMode = 0;
  camera = new Vec3();
  prevCamera = new Vec3();
  /** Camera yaw/pitch exactly as the original computes them (used for the background). */
  yaw = 0;
  pitch = 0;

  tick = 0;
  elapsedMs = 0;
  finished = false;
  lost = false;

  sounds: SoundEvent[] = [];
  readonly rand = new MsvcRand(1);

  constructor(file: ThreeDoFile) {
    this.objects = file.objects.map((m) => new SimObject(m));
    this.routes = RouteTable.fromPoints(file.points);
    for (const r of file.points) {
      const mp = new MovingPoint(fromPoint(...r.position).f32(), r.route, r.routePoint, r.routeSpeed);
      this.points.push(mp);
      if (isHelper(r) && r.name.startsWith('START')) this.startPosition.copy(mp.origin);
      else if (isHelper(r) && r.name.startsWith('DIA')) this.diamonds.push(new Diamond(mp));
    }
    for (let i = 0; i < MAX_PARTICLES; i++) this.particles.push(new Particle());
    this.reset();
  }

  reset(): void {
    for (const o of this.objects) o.reset();
    for (const p of this.points) p.reset();
    for (const d of this.diamonds) {
      d.fade = 0;
      d.alive = true;
      d.position.copy(d.point.position);
      d.prevPosition.copy(d.position);
    }
    for (const p of this.particles) p.alive = false;
    this.position.copy(this.startPosition);
    this.prevPosition.copy(this.startPosition);
    this.velocity.set(0, 0, 0);
    this.carry.set(0, 0, 0);
    this.ballType = BallType.Normal;
    this.prevBallType = BallType.Normal;
    this.jumpTimer = 0;
    this.zapTimer = 0;
    this.contactCount = 0;
    this.ballLight = { range: 1, color: [0, 0, 0] };
    this.camera.set(this.startPosition.x - 100 - 100 * this.cameraMode, this.startPosition.y + 100, this.startPosition.z);
    this.prevCamera.copy(this.camera);
    this.yaw = 0;
    this.pitch = 0;
    this.tick = 0;
    this.elapsedMs = 0;
    this.finished = false;
    this.lost = false;
    this.sounds = [];
  }

  diamondsLeft(): number {
    let n = 0;
    for (const d of this.diamonds) if (d.alive && d.fade === 0) n++;
    return n;
  }

  /** Diamonds still in the level, including ones shrinking away (0x407260). */
  diamondsPresent(): number {
    let n = 0;
    for (const d of this.diamonds) if (d.alive) n++;
    return n;
  }

  speedKmh(): number {
    return Math.trunc(this.velocity.length() * 20);
  }

  step(input: Input): void {
    this.advanceEnvironment();
    this.stepBall(input);
  }

  /**
   * Everything that does not depend on the ball: spinning objects, routes,
   * particles and fading diamonds. (The original spins objects at the end of a
   * tick; doing it at the start of the next one is equivalent.)
   */
  advanceEnvironment(): void {
    for (const o of this.objects) {
      o.prevPosition.copy(o.position);
      o.prevAngles.copy(o.angles);
    }
    for (const p of this.points) p.prevPosition.copy(p.position);
    for (const d of this.diamonds) d.prevPosition.copy(d.position);
    if (this.tick > 0) this.spinObjects();
    this.updateParticles();
    this.updateDiamondFades();
    this.moveObjectsAlongRoutes();
    this.movePointsAlongRoutes();
    for (const d of this.diamonds) d.position.copy(d.point.position);
  }

  stepBall(input: Input): void {
    this.prevPosition.copy(this.position);
    this.prevCamera.copy(this.camera);
    this.applySteering(input);
    this.velocity.y = Math.fround(this.velocity.y - GRAVITY);
    this.applyBallType(input);

    this.position.add(this.velocity).add(this.carry).f32();
    this.velocity.scale(AIR_DRAG).f32();

    const prevCarry = this.carry.clone();
    this.carry.set(0, 0, 0);
    const contacts = this.detectContacts();
    this.contactCount = contacts.length;
    if (this.respond(contacts) <= 0) this.carry.set(0, 0, 0);
    this.velocity.add(prevCarry).sub(this.carry).f32();

    this.collectDiamonds();
    this.updateCamera();

    this.tick++;
    if (!this.finished) this.elapsedMs += TICK_MS;
    if (!this.lost && !this.finished && this.position.y + FALL_LIMIT <= this.lowestObjectPoint()) this.lost = true;
  }

  private lowestObjectPoint(): number {
    let lowest = Infinity;
    for (const o of this.objects) lowest = Math.min(lowest, o.position.y + o.boundMin.y);
    return lowest;
  }

  /** Horizontal forward/right axes derived from the camera. */
  steeringAxes(): [Vec3, Vec3] {
    let fx = this.position.x - this.camera.x;
    let fz = this.position.z - this.camera.z;
    const len = Math.hypot(fx, fz);
    if (len < 1e-6) {
      fx = 1;
      fz = 0;
    } else {
      fx /= len;
      fz /= len;
    }
    // right = forward x up
    return [new Vec3(fx, 0, fz), new Vec3(-fz, 0, fx)];
  }

  private applySteering(input: Input): void {
    let factor = 1;
    if (this.classicSteering) {
      // BALLS.EXE tests (up && left) || right, so Right alone is 30% weaker.
      if ((input.up && input.left) || input.right) factor = DIAGONAL_FACTOR;
    } else if ((input.up || input.down) && (input.left || input.right)) {
      factor = DIAGONAL_FACTOR;
    }
    const amount = ACCELERATION * factor * (this.ballType === BallType.Red ? 2 : 1);
    const [f, r] = this.steeringAxes();
    if (input.up) this.velocity.addScaled(f, amount);
    if (input.down) this.velocity.addScaled(f, -amount);
    if (input.left) this.velocity.addScaled(r, -amount);
    if (input.right) this.velocity.addScaled(r, amount);
    this.velocity.f32();
  }

  private sound(sample: string, volume = 63, count = 1): void {
    this.sounds.push({ sample, volume, count });
  }

  private applyBallType(input: Input): void {
    const L = this.ballLight;
    switch (this.ballType) {
      case BallType.Normal:
        L.range = 1;
        L.color = [0, 0, 0];
        break;
      case BallType.Red:
        this.sparks(2, [1, 0.2, 0.2], -3, true);
        L.range = 300;
        L.color = [1, 0.2, 0.2];
        break;
      case BallType.Yellow: {
        if (this.contactCount > 0 && this.jumpTimer === 0 && input.action) {
          this.velocity.y = Math.fround(this.velocity.y + JUMP_SPEED);
          this.jumpTimer = JUMP_COOLDOWN;
        }
        if (this.jumpTimer > 0) this.jumpTimer--;
        if (this.jumpTimer > 0) {
          this.sparks(2, [1, 1, 0.2], -1, true);
          if (L.range < 500) L.range = Math.trunc(L.range + 50);
          L.color = [L.color[0] < 1 ? L.color[0] + 0.1 : L.color[0], L.color[1] < 1 ? L.color[1] + 0.1 : L.color[1], L.color[2] < 0 ? L.color[2] + 0.1 : L.color[2]];
        } else {
          this.fadeLight();
        }
        break;
      }
      case BallType.Blue: {
        for (const d of this.diamonds) {
          if (d.alive && d.fade === 0 && this.position.distanceTo(d.position) < BLUE_ZAP_RANGE) {
            d.fade = 1;
            this.zapTarget.copy(d.position);
            this.sound('thun', 63, 2);
            this.zapTimer = ZAP_TICKS;
          }
        }
        if (this.zapTimer > 0) this.zapTimer--;
        L.range = 200;
        L.color = [0, 0, 1];
        if (this.zapTimer > 0) {
          L.range = 2000;
          L.color = [0.8, 0.8, 1];
        }
        break;
      }
      case BallType.Green:
        if (input.action) {
          this.velocity.scale(GREEN_BRAKE).f32();
          this.sparks(2, [0.2, 1, 0.2], -1, false);
          if (L.range < 500) L.range = Math.trunc(L.range + 50);
          L.color = [L.color[0] < 0 ? L.color[0] + 0.1 : L.color[0], L.color[1] < 1 ? L.color[1] + 0.1 : L.color[1], L.color[2] < 0 ? L.color[2] + 0.1 : L.color[2]];
        } else {
          this.fadeLight();
        }
        break;
    }
    if (this.ballType !== this.prevBallType) this.sound(TYPE_SOUND[this.ballType], 63, 4);
    this.prevBallType = this.ballType;
  }

  private fadeLight(): void {
    const L = this.ballLight;
    if (L.range > 1) L.range = Math.trunc(L.range - 50);
    L.color = L.color.map((c) => (c > 0 ? c - 0.1 : c)) as [number, number, number];
  }

  /** Spark emitter shared by the red, yellow and green balls (0x408f7c...). */
  private sparks(count: number, color: [number, number, number], ageStep: number, moving: boolean): void {
    const v = this.velocity;
    const half = v.length() * 0.5;
    for (let k = 0; k < count; k++) {
      const ox = v.x / half + 2 * v.x + 4 * this.rand.noise();
      const oy = v.y / half + 2 * v.y + 4 * this.rand.noise();
      const oz = v.z / half + 2 * v.z + 4 * this.rand.noise();
      if (!Number.isFinite(ox + oy + oz)) continue;
      const pos = new Vec3(this.position.x + ox, this.position.y + oy, this.position.z + oz);
      const vel = moving ? v.clone().scale(1 / 3) : new Vec3();
      this.spawnParticle(pos, vel, color, 30, ageStep);
    }
  }

  spawnParticle(pos: Vec3, vel: Vec3, color: [number, number, number], size: number, ageStep: number): void {
    let p = this.particles.find((q) => !q.alive);
    if (!p) p = this.particles[this.particles.length - 1];
    p.alive = true;
    p.position.copy(pos);
    p.prevPosition.copy(pos);
    p.velocity.copy(vel);
    p.color = color;
    p.size = size;
    p.ageStep = ageStep;
    p.age = ageStep < 0 ? 31 : 0;
    p.roll = this.rand.noise() * 2 * Math.PI;
    p.rollSpeed = 0.1 - this.rand.noise() * 0.2;
  }

  private updateParticles(): void {
    for (const p of this.particles) {
      if (!p.alive) continue;
      p.prevPosition.copy(p.position);
      p.position.add(p.velocity);
      p.roll += p.rollSpeed;
      p.age += p.ageStep;
      if (p.age >= 32 || p.age <= 0) p.alive = false;
    }
  }

  private updateDiamondFades(): void {
    for (const d of this.diamonds) {
      if (d.alive && d.fade > 0) {
        d.fade = Math.fround(d.fade - DIAMOND_FADE);
        if (d.fade <= 0) d.alive = false;
      }
    }
  }

  private moveObjectsAlongRoutes(): void {
    for (const o of this.objects) {
      o.routeVelocity.set(0, 0, 0);
      if (!RouteTable.isValidReference(o.route, o.routePoint)) continue;
      if (o.wait >= 1) {
        o.wait--;
        continue;
      }
      const target = this.routes.get(o.route, o.routePoint);
      if (!target) continue;
      let dist = o.position.distanceTo(target.position);
      if (dist === 0) dist = 1;
      const step = 0.01 * o.routeSpeed * target.speedPercent;
      if (step < dist) {
        const k = step / dist;
        const delta = target.position.clone().sub(o.position).scale(k).f32();
        o.position.add(delta).f32();
        o.routeVelocity.copy(delta);
        const prev = this.routes.get(o.route, this.routes.previous(o.route, o.routePoint));
        if (prev) {
          let seg = prev.position.distanceTo(target.position);
          if (seg === 0) seg = 1;
          const s = o.routeSpeed / seg;
          o.angles.set(
            wrapAngle(o.angles.x - angleDelta(target.angles.x, prev.angles.x) * s),
            wrapAngle(o.angles.y - angleDelta(target.angles.y, prev.angles.y) * s),
            wrapAngle(o.angles.z - angleDelta(target.angles.z, prev.angles.z) * s),
          );
        }
      } else {
        o.wait = target.wait;
        o.position.copy(target.position);
        o.angles.copy(target.angles);
        o.routePoint = this.routes.next(o.route, o.routePoint);
      }
      if (o.spinRate.isZero() && !o.angles.equals(o.prevAngles)) {
        o.prevVerts.set(o.verts);
        o.applyRotation();
      }
    }
  }

  private movePointsAlongRoutes(): void {
    for (const p of this.points) {
      if (!RouteTable.isValidReference(p.route, p.point)) continue;
      if (p.wait >= 1) {
        p.wait--;
        continue;
      }
      const target = this.routes.get(p.route, p.point);
      if (!target) continue;
      let dist = p.position.distanceTo(target.position);
      if (dist === 0) dist = 1;
      const step = 0.01 * p.speed * target.speedPercent;
      if (step < dist) {
        p.position.add(target.position.clone().sub(p.position).scale(step / dist)).f32();
      } else {
        p.wait = target.wait;
        p.position.copy(target.position);
        p.point = this.routes.next(p.route, p.point);
      }
    }
  }

  private detectContacts(): Contact[] {
    const result: Contact[] = [];
    const pos = this.position;
    const v = this.velocity;
    const k = this.lookahead;
    const px = pos.x + v.x * k, py = pos.y + v.y * k, pz = pos.z + v.z * k;
    const avx = Math.abs(v.x), avy = Math.abs(v.y), avz = Math.abs(v.z);
    const mx = BROADPHASE_MARGIN + avx, my = BROADPHASE_MARGIN + avy, mz = BROADPHASE_MARGIN + avz;
    for (const o of this.objects) {
      const rx = pos.x - o.position.x, ry = pos.y - o.position.y, rz = pos.z - o.position.z;
      if (rx >= o.boundMax.x + mx || rx <= o.boundMin.x - mx) continue;
      if (ry >= o.boundMax.y + my || ry <= o.boundMin.y - my) continue;
      if (rz >= o.boundMax.z + mz || rz <= o.boundMin.z - mz) continue;
      const lx = px - o.position.x, ly = py - o.position.y, lz = pz - o.position.z;
      const V = o.verts, I = o.indices, FMIN = o.faceMin, FMAX = o.faceMax;
      for (let f = 0; f < I.length / 3; f++) {
        const f3 = f * 3;
        if (rx >= FMAX[f3] + mx || rx <= FMIN[f3] - mx) continue;
        if (rz >= FMAX[f3 + 2] + mz || rz <= FMIN[f3 + 2] - mz) continue;
        if (ry >= FMAX[f3 + 1] + my || ry <= FMIN[f3 + 1] - my) continue;
        const a = I[f3] * 3, b = I[f3 + 1] * 3, c = I[f3 + 2] * 3;
        // Axis aligned lines through the probe: Y first, then X, then Z.
        let t = axisHit(V, a, b, c, lx, ly, lz, 1);
        if (Number.isNaN(t) || Math.abs(t) >= Math.max(avy, BALL_RADIUS)) {
          t = axisHit(V, a, b, c, lx, ly, lz, 0);
          if (Number.isNaN(t) || Math.abs(t) >= Math.max(avx, BALL_RADIUS)) {
            t = axisHit(V, a, b, c, lx, ly, lz, 2);
            if (Number.isNaN(t) || Math.abs(t) >= Math.max(avz, BALL_RADIUS)) continue;
          }
        }
        const contact = { object: o, face: f, depth: Math.abs(t) - BALL_RADIUS };
        if (result.length < MAX_CONTACTS) result.push(contact);
        else result[MAX_CONTACTS - 1] = contact;
      }
    }
    return result;
  }

  /** Applies gate effects and bounces; returns how many contacts carried the ball. */
  private respond(contacts: Contact[]): number {
    if (contacts.length === 0) return 0;
    // Only the deepest solid contact and the deepest contact with an animated
    // object respond (both indices start at contact 0, like the original).
    let deepest = 0;
    let deepestAnimated = 0;
    contacts.forEach((c, i) => {
      if (c.object.special !== Special.Solid) return;
      if (c.depth < contacts[deepest].depth) deepest = i;
      if (c.depth < contacts[deepestAnimated].depth && c.object.isAnimated()) deepestAnimated = i;
    });
    let carried = 0;
    contacts.forEach((c, i) => {
      const gate = c.object.gateBallType();
      if (gate >= 0) {
        this.ballType = gate;
        return;
      }
      if (c.object.special !== Special.Solid || (i !== deepest && i !== deepestAnimated)) return;
      if (this.carryFromFace(c.object, c.face)) carried++;
      this.bounce(c);
    });
    return carried;
  }

  private carryFromFace(o: SimObject, face: number): boolean {
    const best = new Vec3();
    for (let k = 0; k < 3; k++) {
      const vi = o.indices[face * 3 + k] * 3;
      for (let axis = 0; axis < 3; axis++) {
        const d = o.verts[vi + axis] - o.prevVerts[vi + axis];
        if (Math.abs(d) > Math.abs(best.get(axis))) best.setAxis(axis, d);
      }
    }
    best.add(o.routeVelocity);
    if (best.isZero()) return false;
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(best.get(axis)) > Math.abs(this.carry.get(axis))) this.carry.setAxis(axis, best.get(axis));
    }
    return true;
  }

  private bounce(c: Contact): void {
    const o = c.object;
    const n = new Vec3(o.normals[c.face * 3], o.normals[c.face * 3 + 1], o.normals[c.face * 3 + 2]);
    const v = this.velocity;
    const speed = v.length();
    if (speed > 0) {
      const dir = v.clone().scale(1 / speed);
      // Softened reflection: ~0.9 restitution head-on, ~0.6 at grazing angles.
      const k = -Math.sin(BOUNCE_SOFTEN * Math.asin(Math.max(-1, Math.min(1, n.dot(dir)))));
      const nv = dir.addScaled(n, 2 * k).scale(speed).f32();
      const impact = Math.min(nv.clone().sub(v).length(), 15);
      if (impact > 2) this.sound('boun', Math.trunc(impact) * 4, 2);
      v.copy(nv);
    }
    this.position.addScaled(n, -c.depth).f32();
    v.scale(CONTACT_DRAG).f32();
    const b = o.boost;
    if (b.x > 0 || b.y > 0 || b.z > 0) {
      // ADS= pads: the raw vector is applied as (-x, y, -z) in Direct3D space.
      v.set(v.x - b.x * BOOST_SCALE, v.y + b.y * BOOST_SCALE, v.z + b.z * BOOST_SCALE).scale(BOOST_DAMP).f32();
    }
  }

  private collectDiamonds(): void {
    for (const d of this.diamonds) {
      if (d.alive && d.fade === 0 && this.position.distanceTo(d.position) < COLLECT_RADIUS) {
        d.fade = 1;
        this.sound('dia', 63, 2);
      }
    }
    // The level (and its timer) ends once the last diamond has shrunk away.
    if (!this.finished && this.diamondsPresent() === 0) this.finished = true;
  }

  private updateCamera(): void {
    const c = this.camera, p = this.position;
    if (this.cameraMode === 0) {
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d > 50) {
        c.x += (dx / d) * (d - 100);
        c.z += (dz / d) * (d - 100);
      }
      c.y = p.y + 100;
    } else {
      const d = p.distanceTo(c);
      if (d > 70) c.addScaled(p.clone().sub(c), (d - 140) / d);
    }
    c.f32();
    // Background scroll angles, computed in Direct3D space exactly like 0x407450.
    this.yaw = -angleBetween(p.z * -1, p.x, c.z * -1, c.x);
    const horiz = Math.hypot(c.x - p.x, c.z - p.z);
    this.pitch = angleBetween(p.y, 0, c.y, horiz);
  }

  private spinObjects(): void {
    for (const o of this.objects) {
      if (o.spinRate.isZero()) continue;
      o.prevVerts.set(o.verts);
      o.angles.set(o.angles.x + o.spinRate.x, o.angles.y + o.spinRate.y, o.angles.z + o.spinRate.z);
      o.applyRotation();
    }
  }

  /** Shadow plane distance below the ball (0x407a40): five downward probes, minus 0.4. */
  shadowDistance(): number {
    let best = 100000;
    const probes: [number, number][] = [[0, 0], [BALL_RADIUS, 0], [-BALL_RADIUS, 0], [0, BALL_RADIUS], [0, -BALL_RADIUS]];
    const p = this.position;
    for (const o of this.objects) {
      if (o.special !== Special.Solid) continue;
      const rx = p.x - o.position.x, ry = p.y - o.position.y, rz = p.z - o.position.z;
      if (rx >= o.boundMax.x + 25 || rx <= o.boundMin.x - 25 || rz >= o.boundMax.z + 25 || rz <= o.boundMin.z - 25) continue;
      if (ry <= o.boundMin.y - 25) continue;
      const V = o.verts, I = o.indices;
      for (let f = 0; f < I.length / 3; f++) {
        const f3 = f * 3;
        if (o.faceMin[f3 + 1] - 25 >= ry) continue;
        if (rx >= o.faceMax[f3] + 25 || rx <= o.faceMin[f3] - 25 || rz >= o.faceMax[f3 + 2] + 25 || rz <= o.faceMin[f3 + 2] - 25) continue;
        for (const [ox, oz] of probes) {
          const t = axisHit(V, I[f3] * 3, I[f3 + 1] * 3, I[f3 + 2] * 3, rx + ox, ry, rz + oz, 1);
          if (!Number.isNaN(t) && t < 0 && -t < best) best = -t;
        }
      }
    }
    return best - 0.4;
  }

  /** Forces the ball state (replay playback). */
  overrideBall(pos: Vec3, vel: Vec3): void {
    this.position.copy(pos);
    this.velocity.copy(vel);
  }

  /** Snapshot of everything stepBall mutates (tests/tools). */
  saveBallState(): unknown[] {
    return [
      this.position.clone(), this.prevPosition.clone(), this.velocity.clone(), this.carry.clone(),
      this.ballType, this.prevBallType, this.jumpTimer, this.zapTimer, this.zapTarget.clone(),
      this.contactCount, this.camera.clone(), this.prevCamera.clone(), this.tick, this.elapsedMs,
      this.finished, this.lost, this.diamonds.map((d) => d.fade), this.cameraMode, this.yaw, this.pitch,
    ];
  }

  loadBallState(s: unknown[]): void {
    let i = 0;
    this.position.copy(s[i++] as Vec3);
    this.prevPosition.copy(s[i++] as Vec3);
    this.velocity.copy(s[i++] as Vec3);
    this.carry.copy(s[i++] as Vec3);
    this.ballType = s[i++] as BallType;
    this.prevBallType = s[i++] as BallType;
    this.jumpTimer = s[i++] as number;
    this.zapTimer = s[i++] as number;
    this.zapTarget.copy(s[i++] as Vec3);
    this.contactCount = s[i++] as number;
    this.camera.copy(s[i++] as Vec3);
    this.prevCamera.copy(s[i++] as Vec3);
    this.tick = s[i++] as number;
    this.elapsedMs = s[i++] as number;
    this.finished = s[i++] as boolean;
    this.lost = s[i++] as boolean;
    const fades = s[i++] as number[];
    this.diamonds.forEach((d, k) => (d.fade = fades[k]));
    this.cameraMode = s[i++] as number;
    this.yaw = s[i++] as number;
    this.pitch = s[i++] as number;
  }
}

/**
 * Signed distance along an axis from point p to triangle (a, b, c), or NaN.
 * Equivalent to the original two-sided Moller-Trumbore test with an axis ray.
 */
export function axisHit(V: Float64Array, a: number, b: number, c: number, px: number, py: number, pz: number, axis: number): number {
  const u = (axis + 1) % 3, w = (axis + 2) % 3;
  const p = [px, py, pz];
  const e1u = V[b + u] - V[a + u], e1v = V[b + w] - V[a + w];
  const e2u = V[c + u] - V[a + u], e2v = V[c + w] - V[a + w];
  const det = e1u * e2v - e1v * e2u;
  if (Math.abs(det) < 1e-6) return NaN;
  const su = p[u] - V[a + u], sv = p[w] - V[a + w];
  const bu = (su * e2v - sv * e2u) / det;
  if (bu < 0 || bu > 1) return NaN;
  const bv = (e1u * sv - e1v * su) / det;
  if (bv < 0 || bu + bv > 1) return NaN;
  return V[a + axis] + bu * (V[b + axis] - V[a + axis]) + bv * (V[c + axis] - V[a + axis]) - p[axis];
}

/** The engine's 2D angle helper (0x404c30): angle of (b - a) in the (x=2nd, y=1st) plane. */
export function angleBetween(a1: number, a2: number, b1: number, b2: number): number {
  const dx = b2 - a2;
  const dy = b1 - a1;
  if (dx > 1e-4) return Math.atan(dy / dx);
  if (dx < -1e-4) return Math.atan(dy / dx) - Math.PI;
  return -0;
}
