import { weldObjects } from './weld';
/**
 * Reader for the ".3DO" format written by MAKEMAP.EXE for Sebastian Aaltonen's
 * "3D-engine v4.0" (I've got some BALLS, 1999). See docs/REVERSE_ENGINEERING.md.
 * Values are exposed exactly as stored ("raw", Direct3D space).
 */

export const OBJECT_HEADER_SIZE = 0x218c;
export const POINT_RECORD_SIZE = 0x8e;

export enum PointType {
  Light = 1,
  DirectionalLight = 2,
  Helper = 9,
  HelperAlt = 99,
}

export enum BlendMode {
  Normal = 1,
  Additive = 2,
  Subtractive = 3,
}

export interface MeshObject {
  name: string;
  pivot: [number, number, number];
  /** ROX= / ROY= / ROZ= rotation speeds. */
  spin: [number, number, number];
  materialIndex: number;
  /** SP? tag: 0 solid, 1 NOCOL, 2..6 gates (5 also marks shadow planes in models). */
  special: number;
  route: number;
  routePoint: number;
  routeSpeed: number;
  /** ADS= / ADs= boost vector. */
  boost: [number, number, number];
  blend: number;
  transparency: number;
  selfIllumination: number;
  twoSided: boolean;
  diffuse: [number, number, number];
  ambient: [number, number, number];
  texture: string;
  vertices: Float32Array; // xyz, absolute
  uvs: Float32Array; // uv
  faces: Int32Array; // 7 per face: v0 v1 v2 t0 t1 t2 smooth
  /** Positions (absolute, as in `vertices`) and mirrored-space vertex normals after the loader's seam welding. */
  welded?: { vertices: Float32Array; normals: Float32Array };
}

export interface PointRecord {
  name: string;
  type: number;
  /** As stored: (x, z, y) relative to vertex space. */
  position: [number, number, number];
  color: [number, number, number];
  lightRange: number;
  glow: number;
  route: number;
  routePoint: number;
  routeSpeed: number;
  routeId: number;
  routeIndex: number;
  routeWait: number;
  routeSpeedPercent: number;
  routeAngles: [number, number, number];
}

export interface ThreeDoFile {
  version: number;
  materialCount: number;
  background: string;
  objects: MeshObject[];
  points: PointRecord[];
}

export const isLight = (p: PointRecord) => p.type === PointType.Light || p.type === PointType.DirectionalLight;
export const isHelper = (p: PointRecord) => !isLight(p) && p.type > 0;
export const faceCount = (m: MeshObject) => m.faces.length / 7;

function cstring(view: DataView, offset: number, maxLen: number): string {
  let s = '';
  for (let i = 0; i < maxLen; i++) {
    const c = view.getUint8(offset + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

const vec3 = (v: DataView, p: number): [number, number, number] => [
  v.getFloat32(p, true),
  v.getFloat32(p + 4, true),
  v.getFloat32(p + 8, true),
];

export function parseThreeDo(buffer: ArrayBuffer, source = '<memory>'): ThreeDoFile {
  const v = new DataView(buffer);
  if (buffer.byteLength < 36) throw new Error(`3DO: ${source} is truncated`);
  const version = v.getFloat32(0, true);
  if (version < 4) throw new Error(`3DO: ${source} has version ${version}, need 4.0`);
  const objectCount = v.getInt32(4, true);
  const materialCount = v.getInt32(8, true);
  const pointCount = v.getInt32(12, true);
  const background = cstring(v, 16, 20);
  const objects: MeshObject[] = [];
  let p = 36;
  for (let i = 0; i < objectCount; i++) {
    if (p + OBJECT_HEADER_SIZE > buffer.byteLength) throw new Error(`3DO: ${source} object ${i} truncated`);
    const vertCount = v.getInt32(p + 0x2c, true);
    const uvCount = v.getInt32(p + 0x30, true);
    const fc = v.getInt32(p + 0x34, true);
    const obj: MeshObject = {
      name: cstring(v, p, 32),
      pivot: vec3(v, p + 0x20),
      spin: [v.getInt32(p + 0x38, true), v.getInt32(p + 0x3c, true), v.getInt32(p + 0x40, true)],
      materialIndex: v.getInt32(p + 0x44, true),
      special: v.getInt32(p + 0x48, true),
      route: v.getInt32(p + 0x4c, true),
      routePoint: v.getInt32(p + 0x50, true),
      routeSpeed: v.getInt32(p + 0x54, true),
      boost: vec3(v, p + 0x74),
      blend: v.getInt32(p + 0x2154, true),
      transparency: v.getFloat32(p + 0x2158, true),
      selfIllumination: v.getFloat32(p + 0x215c, true),
      twoSided: v.getInt32(p + 0x2160, true) !== 0,
      diffuse: vec3(v, p + 0x2164),
      ambient: vec3(v, p + 0x2170),
      texture: cstring(v, p + 0x2180, 12),
      vertices: new Float32Array(vertCount * 3),
      uvs: new Float32Array(uvCount * 2),
      faces: new Int32Array(fc * 7),
    };
    p += OBJECT_HEADER_SIZE;
    if (p + uvCount * 8 + vertCount * 12 + fc * 28 > buffer.byteLength) {
      throw new Error(`3DO: ${source} object ${i} geometry truncated`);
    }
    for (let k = 0; k < uvCount * 2; k++, p += 4) obj.uvs[k] = v.getFloat32(p, true);
    for (let k = 0; k < vertCount * 3; k++, p += 4) obj.vertices[k] = v.getFloat32(p, true);
    for (let k = 0; k < fc * 7; k++, p += 4) obj.faces[k] = v.getInt32(p, true);
    objects.push(obj);
  }
  const points: PointRecord[] = [];
  for (let i = 0; i < pointCount; i++) {
    if (p + POINT_RECORD_SIZE > buffer.byteLength) throw new Error(`3DO: ${source} point ${i} truncated`);
    points.push({
      name: cstring(v, p, 32),
      type: v.getInt32(p + 32, true),
      position: vec3(v, p + 36),
      color: vec3(v, p + 48),
      lightRange: v.getInt32(p + 84, true),
      glow: v.getFloat32(p + 88, true),
      route: v.getInt32(p + 104, true),
      routePoint: v.getInt32(p + 108, true),
      routeSpeed: v.getInt32(p + 112, true),
      routeId: v.getInt32(p + 116, true),
      routeIndex: v.getInt32(p + 120, true),
      routeWait: v.getInt32(p + 124, true),
      routeSpeedPercent: v.getInt32(p + 128, true),
      // The record is 0x8E bytes, so only the low half of the last angle exists.
      routeAngles: [v.getInt32(p + 132, true), v.getInt32(p + 136, true), v.getInt16(p + 140, true)],
    });
    p += POINT_RECORD_SIZE;
  }
  weldObjects(objects);
  return { version, materialCount, background, objects, points };
}
