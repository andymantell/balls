import * as THREE from 'three';

/**
 * The "rolled" background: a full-screen quad whose UVs follow the camera.
 * u = 3/(2 pi) * yaw (+1 across the screen), v = 3/(2 pi) * (pitch - 0.788).
 * Because a full turn scrolls exactly three texture widths, the wrap of the
 * yaw angle is seamless. (0x40cfce)
 */
const K = 0.477327;

export class Background {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);
  private mesh: THREE.Mesh;
  private uv: THREE.BufferAttribute;

  constructor() {
    const g = new THREE.BufferGeometry();
    // v0 bottom-left, v1 top-left, v2 bottom-right, v3 top-right (as in BALLS.EXE)
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0]), 3));
    this.uv = new THREE.BufferAttribute(new Float32Array(8), 2);
    g.setAttribute('uv', this.uv);
    g.setIndex([0, 1, 2, 2, 1, 3]);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: null } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(map, vUv).rgb, 1.0); }`,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  set texture(t: THREE.Texture | null) {
    (this.mesh.material as THREE.ShaderMaterial).uniforms.map.value = t;
    this.mesh.visible = !!t;
  }

  get visible(): boolean {
    return this.mesh.visible;
  }

  update(yaw: number, pitch: number): void {
    const u = K * yaw;
    const v = K * (pitch - 0.788);
    const a = this.uv.array as Float32Array;
    a.set([u, v + 1, u, v, u + 1, v + 1, u + 1, v]);
    this.uv.needsUpdate = true;
  }
}
