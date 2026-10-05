import { Vec3 } from '../core/vec3';
import { fromPoint } from '../core/coords';
import type { PointRecord } from '../core/threeDo';

/**
 * Route points ("ROU=XXYY"). Routes are numbered 1..98 and each holds up to 98
 * points, exactly like the fixed 99 x 99 table of the original engine.
 */
export const ROUTE_TABLE_SIZE = 99;
const DEG = 0.0174533;

export interface RoutePoint {
  position: Vec3;
  /** Radians, engine semantics. */
  angles: Vec3;
  wait: number;
  speedPercent: number;
}

export class RouteTable {
  private routes = new Map<number, (RoutePoint | undefined)[]>();

  static fromPoints(points: PointRecord[]): RouteTable {
    const t = new RouteTable();
    for (const r of points) {
      if (r.routeId <= 0 || r.routeId >= ROUTE_TABLE_SIZE || r.routeIndex < 0 || r.routeIndex >= ROUTE_TABLE_SIZE || r.type <= 0) continue;
      let arr = t.routes.get(r.routeId);
      if (!arr) {
        arr = new Array(ROUTE_TABLE_SIZE);
        t.routes.set(r.routeId, arr);
      }
      arr[r.routeIndex] = {
        position: fromPoint(...r.position).f32(),
        angles: new Vec3(Math.fround(r.routeAngles[0] * DEG), Math.fround(r.routeAngles[1] * DEG), Math.fround(r.routeAngles[2] * DEG)),
        wait: r.routeWait,
        speedPercent: r.routeSpeedPercent !== 0 ? r.routeSpeedPercent : 100,
      };
    }
    return t;
  }

  static isValidReference(route: number, point: number): boolean {
    return route > 0 && route < ROUTE_TABLE_SIZE && point > 0 && point < ROUTE_TABLE_SIZE;
  }

  get(route: number, index: number): RoutePoint | undefined {
    return this.routes.get(route)?.[index];
  }

  /** Point after [index], wrapping to 1 like the original. */
  next(route: number, index: number): number {
    let n = index + 1;
    if (n >= ROUTE_TABLE_SIZE) n = 1;
    if (!this.get(route, n)) n = 1;
    return n;
  }

  /** Point before [index], wrapping to the last used point. */
  previous(route: number, index: number): number {
    let p = index - 1;
    if (p >= 1) return p;
    p = ROUTE_TABLE_SIZE - 1;
    while (p > 1 && !this.get(route, p)) p--;
    return p;
  }
}

/** Signed angle difference with the original's quirks (0x407190). */
export function angleDelta(a: number, b: number): number {
  if (Math.abs(a - b) < Math.PI) return b - a;
  if (a < b) return b - a - 2 * Math.PI;
  if (b < a) return 2 * Math.PI - a + b;
  return 0;
}

/** Wraps an angle to [0, 2pi) like 0x407140. */
export function wrapAngle(a: number): number {
  const t = 2 * Math.PI;
  return ((a % t) + t) % t;
}
