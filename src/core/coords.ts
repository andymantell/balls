import { Vec3 } from './vec3';

/**
 * The 1999 engine renders through Direct3D 6 in a left-handed space (+Y up).
 * three.js is right-handed, so the port mirrors the Z axis. Physics behaves the
 * same in the mirrored space, so all constants are kept verbatim.
 *
 * Helper points (START, DIA, ROU=, lights...) are stored by MAKEMAP with their
 * Y and Z components swapped relative to mesh vertices.
 */
export const fromD3D = (x: number, y: number, z: number): Vec3 => new Vec3(x, y, -z);
export const toD3D = (v: Vec3): Vec3 => new Vec3(v.x, v.y, -v.z);
export const fromPoint = (x: number, y: number, z: number): Vec3 => new Vec3(x, z, -y);
