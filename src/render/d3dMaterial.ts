import * as THREE from 'three';
import { BlendMode, type MeshObject } from '../core/threeDo';

/**
 * Emulates Direct3D 6's fixed-function pipeline as BALLS.EXE configured it:
 *  - per-vertex (Gouraud) lighting with point lights,
 *    attenuation 1 / (1 + d / range) (D3DLIGHT2 att0 = 1, att1 = 1/range),
 *    no global ambient, material emissive = the object's "ambient" glow colour;
 *  - normals transformed by the world matrix but not renormalised;
 *  - texture MODULATE vertex colour, optional specular added afterwards;
 *  - blend modes: alpha (transparency), ONE/ONE (additive),
 *    ZERO/INVSRCCOLOR (subtractive); no depth writes for blended objects.
 */

export const MAX_LIGHTS = 16;

export interface LightUniforms {
  lightPos: { value: THREE.Vector3[] };
  lightColor: { value: THREE.Color[] };
  lightInvRange: { value: number[] };
  lightCount: { value: number };
  specularOn: { value: boolean };
  specularScale: { value: number };
}

export function createLightUniforms(): LightUniforms {
  return {
    lightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3()) },
    lightColor: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Color(0, 0, 0)) },
    lightInvRange: { value: new Array(MAX_LIGHTS).fill(0) },
    lightCount: { value: 0 },
    specularOn: { value: false },
    specularScale: { value: 1 },
  };
}

const vertexShader = /* glsl */ `
#define MAX_LIGHTS ${MAX_LIGHTS}
uniform vec3 lightPos[MAX_LIGHTS];
uniform vec3 lightColor[MAX_LIGHTS];
uniform float lightInvRange[MAX_LIGHTS];
uniform int lightCount;
uniform bool specularOn;
uniform float specularScale;
uniform vec4 diffuse;
uniform vec3 emissive;
uniform vec2 uvOffset;
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vSpecular;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 n = mat3(modelMatrix) * normal;
  vec3 c = emissive;
  vec3 s = vec3(0.0);
  vec3 toEye = normalize(cameraPosition - wp.xyz);
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= lightCount) break;
    vec3 l = lightPos[i] - wp.xyz;
    float d = length(l);
    l /= max(d, 1e-6);
    float ndl = dot(n, l);
    if (ndl > 0.0) {
      float att = 1.0 / (1.0 + d * lightInvRange[i]);
      c += diffuse.rgb * lightColor[i] * ndl * att;
      if (specularOn) {
        float nh = max(dot(n, normalize(l + toEye)), 0.0);
        s += specularScale * lightColor[i] * pow(nh, 30.0) * att;
      }
    }
  }
  vColor = vec4(clamp(c, 0.0, 1.0), diffuse.a);
  vSpecular = clamp(s, 0.0, 1.0);
  vUv = uv + uvOffset;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const fragmentShader = /* glsl */ `
uniform sampler2D map;
uniform bool hasMap;
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vSpecular;
void main() {
  vec3 t = hasMap ? texture2D(map, vUv).rgb : vec3(1.0);
  gl_FragColor = vec4(t * vColor.rgb + vSpecular, vColor.a);
}`;

export interface D3DMaterialParams {
  diffuse: [number, number, number];
  emissive: [number, number, number];
  opacity: number;
  blend: number;
  twoSided: boolean;
  map: THREE.Texture | null;
}

export class D3DMaterial extends THREE.ShaderMaterial {
  constructor(lights: LightUniforms, p: D3DMaterialParams) {
    super({
      vertexShader,
      fragmentShader,
      uniforms: {
        ...lights,
        diffuse: { value: new THREE.Vector4(p.diffuse[0], p.diffuse[1], p.diffuse[2], p.opacity) },
        emissive: { value: new THREE.Color(...p.emissive) },
        map: { value: p.map },
        hasMap: { value: !!p.map },
        uvOffset: { value: new THREE.Vector2() },
      },
      side: p.twoSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (p.blend === BlendMode.Additive) {
      this.transparent = true;
      this.blending = THREE.CustomBlending;
      this.blendSrc = THREE.OneFactor;
      this.blendDst = THREE.OneFactor;
      this.depthWrite = false;
    } else if (p.blend === BlendMode.Subtractive) {
      this.transparent = true;
      this.blending = THREE.CustomBlending;
      this.blendSrc = THREE.ZeroFactor;
      this.blendDst = THREE.OneMinusSrcColorFactor;
      this.depthWrite = false;
    } else if (p.opacity < 1) {
      this.transparent = true;
      this.blending = THREE.CustomBlending;
      this.blendSrc = THREE.SrcAlphaFactor;
      this.blendDst = THREE.OneMinusSrcAlphaFactor;
      this.depthWrite = false;
    } else {
      this.blending = THREE.NoBlending;
    }
  }

  get emissiveColor(): THREE.Color {
    return this.uniforms.emissive.value as THREE.Color;
  }

  get uvOffset(): THREE.Vector2 {
    return this.uniforms.uvOffset.value as THREE.Vector2;
  }

  /** True for objects drawn in the original's second (blended) pass. */
  get blended(): boolean {
    return this.transparent;
  }
}

/** Material parameters of a .3DO object as BALLS.EXE derives them at load time. */
export function materialParams(m: MeshObject, map: THREE.Texture | null): D3DMaterialParams {
  const si = m.selfIllumination;
  return {
    diffuse: m.diffuse,
    emissive: [m.ambient[0] + si, m.ambient[1] + si, m.ambient[2] + si],
    opacity: 1 - m.transparency,
    blend: m.blend,
    twoSided: m.twoSided,
    map,
  };
}
