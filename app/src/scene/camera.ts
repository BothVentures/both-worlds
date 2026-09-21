import * as THREE from 'three'
import { clamp, deg, easeInOutCubic, lerp } from './util'

export interface Framing {
  target: THREE.Vector3
  distance: number
  azimuth: number // radians
  elevation: number // radians (0 = horizon, π/2 = top-down)
}

/**
 * Deliberate camera: spherical framing + timed tween + optional slow orbit.
 * No physics, no inertia surprises — every move is reproducible.
 */
export class CameraDirector {
  camera: THREE.PerspectiveCamera
  current: Framing
  private from: Framing | null = null
  private to: Framing | null = null
  private t0 = 0
  private dur = 1600
  orbitSpeed = 0 // rad/s, set by the app (0 when paused / reduced motion)
  private orbitOffset = 0
  onArrive: (() => void) | null = null
  /** true while a flyTo tween is in progress (used by the test harness to wait for the camera to settle) */
  get busy() { return this.to !== null }

  constructor(camera: THREE.PerspectiveCamera, initial: Framing) {
    this.camera = camera
    this.current = { ...initial, target: initial.target.clone() }
    this.apply(this.current, 0)
  }

  flyTo(f: Framing, duration = 1600) {
    // fold accumulated orbit into the start azimuth so the tween starts where we are
    const start: Framing = { ...this.current, target: this.current.target.clone(), azimuth: this.current.azimuth + this.orbitOffset }
    this.orbitOffset = 0
    // shortest angular path
    let az = f.azimuth
    while (az - start.azimuth > Math.PI) az -= Math.PI * 2
    while (az - start.azimuth < -Math.PI) az += Math.PI * 2
    this.from = start
    this.to = { ...f, target: f.target.clone(), azimuth: az }
    this.t0 = performance.now()
    this.dur = Math.max(1, duration)
    if (duration <= 0) {
      this.current = { ...this.to, target: this.to.target.clone() }
      this.from = this.to = null
    }
  }

  /** manual nudge (explore mode) */
  nudge(dAz: number, dEl: number, dDist: number, pan?: THREE.Vector3) {
    this.from = this.to = null
    this.current.azimuth += dAz + this.orbitOffset
    this.orbitOffset = 0
    this.current.elevation = clamp(this.current.elevation + dEl, deg(12), deg(80))
    this.current.distance = clamp(this.current.distance * (1 + dDist), 6, 420)
    if (pan) this.current.target.add(pan)
  }

  update(dtMs: number) {
    if (this.from && this.to) {
      const k = clamp((performance.now() - this.t0) / this.dur, 0, 1)
      const e = easeInOutCubic(k)
      // the target leads the camera slightly ("look, then travel" — Mass Effect / Destiny zoom-to-select)
      const et = easeInOutCubic(clamp(k * 1.12, 0, 1))
      this.current.target.lerpVectors(this.from.target, this.to.target, et)
      this.current.distance = lerp(this.from.distance, this.to.distance, e)
      this.current.azimuth = lerp(this.from.azimuth, this.to.azimuth, e)
      this.current.elevation = lerp(this.from.elevation, this.to.elevation, e)
      if (k >= 1) {
        this.from = this.to = null
        this.onArrive?.()
      }
    } else if (this.orbitSpeed !== 0) {
      this.orbitOffset += this.orbitSpeed * (dtMs / 1000)
    }
    this.apply(this.current, this.orbitOffset)
  }

  private apply(f: Framing, extraAz: number) {
    const az = f.azimuth + extraAz
    const x = f.target.x + f.distance * Math.cos(f.elevation) * Math.sin(az)
    const z = f.target.z + f.distance * Math.cos(f.elevation) * Math.cos(az)
    const y = f.target.y + f.distance * Math.sin(f.elevation)
    this.camera.position.set(x, y, z)
    this.camera.lookAt(f.target)
    this.camera.updateMatrixWorld()
  }

  /** Framing that fits a horizontal box (w×d at center) into the viewport for a given elevation. */
  fitBox(center: THREE.Vector3, w: number, d: number, elevation: number, azimuth: number, aspect: number, pad = 1.25): Framing {
    const fov = deg(this.camera.fov)
    const halfV = Math.tan(fov / 2)
    const halfH = halfV * aspect
    // project the box footprint roughly: its apparent height shrinks with elevation
    const apparentD = d * Math.sin(elevation) + 2.5 * Math.cos(elevation) // include some vertical content
    const distV = (apparentD * pad) / 2 / halfV
    const distH = (w * pad) / 2 / halfH
    return { target: center.clone(), distance: Math.max(distV, distH, 6), azimuth, elevation }
  }
}
