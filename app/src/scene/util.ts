import * as THREE from 'three'

/** Deterministic PRNG (mulberry32). Same seed → same world on every reload. */
export function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
export const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5)
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const deg = (d: number) => (d * Math.PI) / 180

/** Edges of a box as a LineSegments geometry (12 edges). */
export function boxEdges(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d)
  const e = new THREE.EdgesGeometry(g, 1)
  g.dispose()
  return e
}

/** Rounded-rectangle outline (flat, XZ plane) as a closed polyline. */
export function roundedRectPoints(w: number, d: number, r: number, segs = 6): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  const hw = w / 2, hd = d / 2
  const corners: [number, number, number][] = [
    [hw - r, hd - r, 0],
    [-hw + r, hd - r, Math.PI / 2],
    [-hw + r, -hd + r, Math.PI],
    [hw - r, -hd + r, -Math.PI / 2],
  ]
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= segs; i++) {
      const a = a0 + (i / segs) * (Math.PI / 2)
      pts.push(new THREE.Vector3(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r))
    }
  }
  pts.push(pts[0].clone())
  return pts
}

/** Vertical extrusion of a polyline into wireframe: top ring, bottom ring, verticals every n. */
export function extrudeOutline(pts: THREE.Vector3[], height: number, everyNth = 4): THREE.BufferGeometry {
  const pos: number[] = []
  const push = (a: THREE.Vector3, b: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z)
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    push(a, b)
    push(a.clone().setY(a.y - height), b.clone().setY(b.y - height))
    if (i % everyNth === 0) push(a, a.clone().setY(a.y - height))
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return g
}

/** Soft radial glow texture (canvas) for additive sprites. */
let glowTex: THREE.Texture | null = null
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const grd = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, 'rgba(255,255,255,0.9)')
  grd.addColorStop(0.25, 'rgba(255,255,255,0.35)')
  grd.addColorStop(0.6, 'rgba(255,255,255,0.06)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grd
  ctx.fillRect(0, 0, 128, 128)
  glowTex = new THREE.CanvasTexture(c)
  glowTex.colorSpace = THREE.SRGBColorSpace
  return glowTex
}

/** Quadratic arc between two points, lifted by `lift`. */
export function arcPoints(a: THREE.Vector3, b: THREE.Vector3, lift: number, n = 32): THREE.Vector3[] {
  const mid = a.clone().add(b).multiplyScalar(0.5)
  mid.y += lift
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b)
  return curve.getPoints(n)
}
