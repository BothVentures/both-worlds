import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Entity, Relation, State, WorldData } from '../model/types'
import { computeLayout, territoryAzimuth, worldBounds, type LayoutResult, type Placed } from '../model/layout'
import { CameraDirector, type Framing } from './camera'
import { arcPoints, boxEdges, clamp, deg, easeOutQuint, extrudeOutline, glowTexture, prng, roundedRectPoints } from './util'
import { ACCENT, ACCENT_DIM, ACCENT_HI, BG, INK, STATE_COLOR, TYPE_TINT } from './palette'

export type Level = 'world' | 'territory' | 'project' | 'element'
export interface Focus { level: Level; id: string }

interface Node {
  placed: Placed
  group: THREE.Group
  lines: THREE.LineSegments | THREE.Line
  fill?: THREE.Mesh
  pick: THREE.Mesh
  baseOpacity: number
  targetOpacity: number
  accentLines?: THREE.Line | THREE.LineSegments
  /** secondary line sets that follow the main opacity (floors, bracing, base unit) */
  extras?: { obj: THREE.Object3D; base: number }[]
}

interface LabelEl {
  id: string
  el: HTMLDivElement
  anchor: THREE.Vector3
  level: 1 | 2 | 3
  priority: number
  /** cached box (measured once; label text never changes) */
  bw?: number
  bh?: number
  /** last written state, so hidden labels cost nothing per frame */
  shown?: boolean
}

/** a route: arc + vertical pins + landing dots + packets that travel along it; `revealAt` drives the draw-on */
interface RelObj { arc: THREE.Line; pins: THREE.LineSegments; dots: THREE.Points; packets: THREE.Points; pts: THREE.Vector3[]; revealAt: number; seed: number }

export interface WorldEvents {
  onPick: (id: string | null, level: 1 | 2 | 3 | 0) => void
  onHover: (id: string | null) => void
}

/** deterministic 0..1 hash of a string */
function hash01(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return ((h >>> 0) % 10000) / 10000
}

/** segments of a rectangle loop at height y (local coords) */
function rectSegments(w: number, d: number, y: number, out: number[]) {
  const hw = w / 2, hd = d / 2
  const c = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]
  for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; out.push(a[0], y, a[1], b[0], y, b[1]) }
}
function circleSegments(r: number, y: number, n: number, out: number[], cx = 0, cz = 0) {
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2
    out.push(cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r, cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r)
  }
}
const segGeo = (arr: number[]) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); return g }

export class WorldScene {
  readonly data: WorldData
  readonly layout: LayoutResult
  readonly entities = new Map<string, Entity>()
  readonly relations = new Map<string, Relation>()
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  director: CameraDirector
  private nodes = new Map<string, Node>()
  private labels: LabelEl[] = []
  private labelRoot: HTMLDivElement
  private relationObjects = new Map<string, RelObj>()
  private visibleRelations = new Set<string>()
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private pickables: THREE.Mesh[] = []
  private halos: THREE.Sprite[] = []
  private hatches = new Map<string, THREE.LineSegments>()
  private padFloors = new Map<string, THREE.ShaderMaterial>()
  private beacons: THREE.Sprite[] = []
  /** stage light that follows the focus (Frostpunk / Control: the subject is lit, the rest is not) */
  private spot!: THREE.Sprite
  private spotGoal = { pos: new THREE.Vector3(), scale: 1, opacity: 0 }
  /** arrival pulse (XCOM / Civ selection ring) */
  private pulse!: THREE.Line
  private pulseT0 = -1
  private pulseR = 1
  private dust?: THREE.Points
  private dustVel: Float32Array = new Float32Array(0)
  /** hover = four corner brackets; selection = full ring (Horizon Focus) */
  private hoverMark!: THREE.LineSegments
  private selMark!: THREE.Line
  private focus: Focus = { level: 'world', id: 'world' }
  private highlight = new Set<string>()
  private extraRelations: string[] = []
  /** legend filter: entities that fail the predicate are dimmed (never hidden) */
  private filterFn: ((e: Entity) => boolean) | null = null
  private selected: string | null = null
  private hovered: string | null = null
  private raf = 0
  private last = 0
  private events: WorldEvents
  private canvas: HTMLCanvasElement
  paused = false
  reducedMotion = false
  /** when the evidence panel is open the subject is shifted left on screen */
  panelOpen = false
  interactive = true
  private disposed = false
  private lastCam?: { azimuth?: number; elevation?: number; distance?: number }
  private curve = 0.00075

  constructor(canvas: HTMLCanvasElement, labelRoot: HTMLDivElement, data: WorldData, events: WorldEvents) {
    this.data = data
    this.events = events
    this.canvas = canvas
    this.labelRoot = labelRoot
    for (const e of data.entities) this.entities.set(e.id, e)
    for (const r of data.relations) this.relations.set(r.id, r)
    this.layout = computeLayout(data)

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setClearColor(BG, 0) // the page paints a soft radial ground behind the canvas
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.scene.fog = new THREE.FogExp2(BG, 0.0031)

    this.camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.5, 1200)
    const wb = worldBounds(this.layout.territories)
    const initial: Framing = { target: new THREE.Vector3(wb.cx, 1.5, wb.cz), distance: 160, azimuth: 0.55, elevation: deg(36) }
    this.director = new CameraDirector(this.camera, initial)

    this.buildGround(wb.cx, wb.cz)
    this.buildStage(wb.cx, wb.cz, Math.max(wb.w, wb.d))
    this.buildMountains(wb.cx, wb.cz)
    this.buildAtmosphere(wb.cx, wb.cz)
    this.buildWorld()
    this.resize()
    this.applyFocusStyles()

    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('resize', this.resize)
    this.last = performance.now()
    this.loop()
    ;(window as unknown as { __world?: WorldScene }).__world = this // debugging handle (read-only use)
  }

  // ---------- atmosphere ----------

  private buildGround(cx: number, cz: number) {
    const size = 900
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(0x454c62) } },
      vertexShader: /* glsl */ `
        varying vec3 vW; varying float vDist;
        void main(){ vW = position; vDist = length(position.xz - vec2(${cx.toFixed(2)}, ${cz.toFixed(2)})); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying vec3 vW; varying float vDist;
        float gridLine(vec2 p, float s){ vec2 r = p / s; vec2 g = abs(fract(r - 0.5) - 0.5) / fwidth(r); return 1.0 - min(min(g.x, g.y), 1.0); }
        void main(){
          float a = gridLine(vW.xz, 4.0) * 0.34 + gridLine(vW.xz, 20.0) * 0.8;
          // faint contour rings from the world centre (Frostpunk / Death Stranding): the boundary is felt before the line
          float rr = vDist / 11.0; float ring = 1.0 - min(abs(fract(rr) - 0.5) * 2.0 / max(fwidth(rr) * 2.0, 1e-4), 1.0);
          a += ring * 0.16 * smoothstep(30.0, 60.0, vDist);
          float fade = 1.0 - smoothstep(90.0, 360.0, vDist);
          float near = smoothstep(0.0, 18.0, vDist);
          a *= fade * mix(0.35, 1.0, near);
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    })
    const dense = new THREE.PlaneGeometry(size, size, 90, 90)
    dense.rotateX(-Math.PI / 2)
    const pos = dense.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i)
      const d = Math.hypot(x - cx, z - cz)
      pos.setY(i, -this.curve * d * d - 0.02)
    }
    const ground = new THREE.Mesh(dense, mat)
    ground.renderOrder = -10
    this.scene.add(ground)
  }

  /** a very faint lit "stage" under the world — atmosphere, not data */
  private buildStage(cx: number, cz: number, span: number) {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const ctx = c.getContext('2d')!
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
    g.addColorStop(0, 'rgba(120,150,165,0.30)')
    g.addColorStop(0.5, 'rgba(120,150,165,0.09)')
    g.addColorStop(1, 'rgba(120,150,165,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 256, 256)
    const tex = new THREE.CanvasTexture(c)
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(span * 1.9, span * 1.9), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }))
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(cx, 0.0, cz)
    mesh.renderOrder = -9
    this.scene.add(mesh)
  }

  private buildMountains(cx: number, cz: number) {
    const rnd = prng(20260908)
    const rings = [
      { r0: 92, r1: 30, n: 30, op: 0.8, count: 9 },
      { r0: 150, r1: 60, n: 24, op: 0.5, count: 11 },
    ]
    for (const ring of rings) {
      const mat = new THREE.LineBasicMaterial({ color: 0x3a4153, transparent: true, opacity: ring.op, fog: true })
      for (let k = 0; k < ring.count; k++) {
        const az = (k / ring.count) * Math.PI * 2 + rnd() * 0.4
        const r = ring.r0 + rnd() * ring.r1
        const mx = cx + Math.sin(az) * r, mz = cz + Math.cos(az) * r
        const n = ring.n, span = 38 + rnd() * 34
        const h = 6 + rnd() * 12
        const seedA = rnd() * 100, seedB = rnd() * 100
        const heights: number[][] = []
        for (let i = 0; i <= n; i++) {
          heights.push([])
          for (let j = 0; j <= n; j++) {
            const u = i / n - 0.5, v = j / n - 0.5
            const rim = Math.max(0, 1 - Math.hypot(u, v) * 2.05)
            const y =
              (Math.sin(u * 9 + seedA) * Math.cos(v * 7 + seedB) * 0.5 + 0.5) * 0.6 +
              (Math.sin(u * 23 + seedB) * Math.sin(v * 19 + seedA) * 0.5 + 0.5) * 0.3 +
              rnd() * 0.12
            heights[i].push(y * rim * h)
          }
        }
        const pts: number[] = []
        const at = (i: number, j: number) => {
          const x = mx + (i / n - 0.5) * span, z = mz + (j / n - 0.5) * span
          const d = Math.hypot(x - cx, z - cz)
          return [x, heights[i][j] - this.curve * d * d, z]
        }
        for (let i = 0; i <= n; i++) for (let j = 0; j < n; j++) pts.push(...at(i, j), ...at(i, j + 1))
        for (let j = 0; j <= n; j++) for (let i = 0; i < n; i++) pts.push(...at(i, j), ...at(i + 1, j))
        const m = new THREE.LineSegments(segGeo(pts), mat)
        m.renderOrder = -5
        this.scene.add(m)
      }
    }
  }

  private buildAtmosphere(cx: number, cz: number) {
    // stage light under the focus
    this.spot = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xb9c1d6, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.spot.position.set(cx, 0.3, cz)
    this.spot.renderOrder = -8
    this.scene.add(this.spot)
    // arrival pulse ring (unit circle, scaled per arrival)
    const cp: THREE.Vector3[] = []
    for (let i = 0; i <= 72; i++) { const a = (i / 72) * Math.PI * 2; cp.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a))) }
    this.pulse = new THREE.Line(new THREE.BufferGeometry().setFromPoints(cp), new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, fog: true }))
    this.pulse.visible = false
    this.scene.add(this.pulse)
    // hover brackets + selection ring (placed per target)
    this.hoverMark = new THREE.LineSegments(segGeo([]), new THREE.LineBasicMaterial({ color: ACCENT_HI, transparent: true, opacity: 0.9, fog: true }))
    this.hoverMark.visible = false
    this.hoverMark.renderOrder = 7
    this.scene.add(this.hoverMark)
    this.selMark = new THREE.Line(new THREE.BufferGeometry().setFromPoints(roundedRectPoints(1, 1, 0.12)), new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9, fog: true }))
    this.selMark.visible = false
    this.selMark.renderOrder = 7
    this.scene.add(this.selMark)
    // drifting dust — sparse, slow, fogged; static under reduced motion
    const N = 520, rnd = prng(20260909)
    const pos = new Float32Array(N * 3)
    this.dustVel = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      pos[i * 3] = cx + (rnd() - 0.5) * 190; pos[i * 3 + 1] = 0.5 + rnd() * 26; pos[i * 3 + 2] = cz + (rnd() - 0.5) * 190
      this.dustVel[i * 3] = (rnd() - 0.5) * 0.0012; this.dustVel[i * 3 + 1] = 0.0004 + rnd() * 0.0009; this.dustVel[i * 3 + 2] = (rnd() - 0.5) * 0.0012
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9aa3ba, size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0.32, map: glowTexture(), depthWrite: false, blending: THREE.AdditiveBlending, fog: true }))
    this.dust.renderOrder = -4
    this.scene.add(this.dust)
  }

  // ---------- materials ----------

  private lineMat(color: THREE.Color, opacity: number, dashed = false) {
    if (dashed) return new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.22, gapSize: 0.16, fog: true })
    return new THREE.LineBasicMaterial({ color, transparent: true, opacity, fog: true })
  }

  private stateStyle(state: State): { dashed: boolean; opacity: number; color: THREE.Color; fill: number } {
    switch (state) {
      case 'implemented': return { dashed: false, opacity: 0.88, color: INK, fill: 0.72 }
      case 'experimental': return { dashed: true, opacity: 0.8, color: INK, fill: 0.5 }
      case 'proposed': return { dashed: true, opacity: 0.55, color: STATE_COLOR.proposed, fill: 0 }
      case 'parked': return { dashed: false, opacity: 0.32, color: STATE_COLOR.parked, fill: 0.45 }
      case 'retired': return { dashed: false, opacity: 0.22, color: STATE_COLOR.retired, fill: 0.35 }
    }
  }

  // ---------- territories ----------

  private buildWorld() {
    for (const t of this.layout.territories) this.buildTerritory(t)
  }

  private buildTerritory(t: Placed) {
    const accent = new THREE.Color(t.entity.layout?.accent ?? '#e8e4d8')
    const group = new THREE.Group()
    group.position.set(t.x, 0, t.z)
    const r = 1.6
    const outline = roundedRectPoints(t.w, t.d, r)
    const extras: Node['extras'] = []

    // top ring (accent) + body extrusion (ink) + cut-edge strata on the sides
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(outline), this.lineMat(accent, 0.9))
    ring.position.y = t.y
    const body = new THREE.LineSegments(extrudeOutline(outline.map((p) => p.clone().setY(t.y)), t.h, 5), this.lineMat(INK, 0.38))
    const strata: number[] = []
    const rs = prng(Math.floor(hash01(t.id) * 1e6))
    for (let k = 1; k <= 3; k++) {
      const y = t.y - t.h * (k / 4)
      for (let i = 0; i < outline.length - 1; i++) {
        if (rs() < 0.7) { const a = outline[i], b = outline[i + 1]; const jy = (rs() - 0.5) * 0.12; strata.push(a.x, y + jy, a.z, b.x, y + jy, b.z) }
      }
    }
    const strataLines = new THREE.LineSegments(segGeo(strata), this.lineMat(INK, 0.14))
    extras.push({ obj: strataLines, base: 0.14 })

    // dark top face (occlusion + picking) and dark side skirt
    const shape = new THREE.Shape()
    outline.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, -p.z) : shape.lineTo(p.x, -p.z)))
    const faceGeo = new THREE.ShapeGeometry(shape)
    faceGeo.rotateX(-Math.PI / 2)
    const face = new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({ color: 0x0a0d16, transparent: true, opacity: 0.94, depthWrite: true }))
    face.position.y = t.y - 0.01
    face.renderOrder = 1
    face.userData.id = t.id
    face.userData.level = 1
    const side = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: t.h, bevelEnabled: false }), new THREE.MeshBasicMaterial({ color: 0x080a12, transparent: true, opacity: 0.9, depthWrite: true }))
    side.rotation.x = Math.PI / 2
    side.position.y = t.y - 0.02
    side.renderOrder = 0

    // ---- base unit (DataV): stepped slabs, struts, core rings
    const baseSeg: number[] = []
    const tiers = 3
    let prevW = t.w, prevD = t.d, prevY = t.y - t.h
    for (let k = 1; k <= tiers; k++) {
      const w = t.w * Math.pow(0.78, k), d = t.d * Math.pow(0.78, k)
      const y = t.y - t.h - k * 1.35
      rectSegments(w, d, y, baseSeg)
      rectSegments(w, d, y - 0.45, baseSeg)
      const c = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]
      for (const [x, z] of c) baseSeg.push(x, y, z, x, y - 0.45, z)
      const pc = [[-prevW / 2, -prevD / 2], [prevW / 2, -prevD / 2], [prevW / 2, prevD / 2], [-prevW / 2, prevD / 2]]
      for (let i = 0; i < 4; i++) baseSeg.push(pc[i][0], prevY, pc[i][1], c[i][0], y, c[i][1])
      prevW = w; prevD = d; prevY = y - 0.45
    }
    const coreR = Math.min(t.w, t.d) * 0.16
    for (let k = 0; k < 5; k++) circleSegments(coreR * (1 - k * 0.08), prevY - k * 0.9, 24, baseSeg)
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; baseSeg.push(Math.cos(a) * coreR, prevY, Math.sin(a) * coreR, Math.cos(a) * coreR * 0.68, prevY - 3.6, Math.sin(a) * coreR * 0.68) }
    const baseUnit = new THREE.LineSegments(segGeo(baseSeg), this.lineMat(INK, 0.22))
    extras.push({ obj: baseUnit, base: 0.22 })

    // ---- dimension ring on the ground: dashed circle + radial ticks (accent, faint)
    const R = Math.hypot(t.w, t.d) * 0.5
    const ringPts: THREE.Vector3[] = []
    for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; ringPts.push(new THREE.Vector3(Math.cos(a) * R, 0.06, Math.sin(a) * R)) }
    const dimRing = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), new THREE.LineDashedMaterial({ color: accent, transparent: true, opacity: 0.35, dashSize: 0.9, gapSize: 0.6, fog: true }))
    dimRing.computeLineDistances()
    const ticks: number[] = []
    for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; const l = i % 12 === 0 ? 1.4 : 0.5; ticks.push(Math.cos(a) * R, 0.06, Math.sin(a) * R, Math.cos(a) * (R + l), 0.06, Math.sin(a) * (R + l)) }
    const tickLines = new THREE.LineSegments(segGeo(ticks), this.lineMat(accent, 0.3))
    extras.push({ obj: dimRing, base: 0.35 }, { obj: tickLines, base: 0.3 })

    // ---- corner brackets (plan drawing)
    const br: number[] = []
    const o = 0.55, L = 1.6, hw = t.w / 2 + o, hd = t.d / 2 + o
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      br.push(sx * hw, t.y, sz * hd, sx * (hw - L), t.y, sz * hd)
      br.push(sx * hw, t.y, sz * hd, sx * hw, t.y, sz * (hd - L))
    }
    const brackets = new THREE.LineSegments(segGeo(br), this.lineMat(INK, 0.5))
    extras.push({ obj: brackets, base: 0.5 })

    // ---- roads between pads (double lines), computed from pad rows
    const roads: number[] = []
    const pads = t.children
    const rows: Placed[][] = []
    for (const p of [...pads].sort((a, b) => a.z - b.z)) {
      const row = rows.find((rw) => Math.abs(rw[0].z - p.z) < 0.6)
      if (row) row.push(p); else rows.push([p])
    }
    const ry = t.y + 0.02
    const xMin = -t.w / 2 + 1.2, xMax = t.w / 2 - 1.2
    for (let i = 0; i < rows.length - 1; i++) {
      const a = Math.max(...rows[i].map((p) => p.z - t.z + p.d / 2)), b = Math.min(...rows[i + 1].map((p) => p.z - t.z - p.d / 2))
      const z = (a + b) / 2
      roads.push(xMin, ry, z - 0.1, xMax, ry, z - 0.1, xMin, ry, z + 0.1, xMax, ry, z + 0.1)
    }
    for (const row of rows) {
      const sorted = [...row].sort((a, b) => a.x - b.x)
      const zA = Math.min(...row.map((p) => p.z - t.z - p.d / 2)) - 0.6, zB = Math.max(...row.map((p) => p.z - t.z + p.d / 2)) + 0.6
      for (let i = 0; i < sorted.length - 1; i++) {
        const x = ((sorted[i].x + sorted[i].w / 2) + (sorted[i + 1].x - sorted[i + 1].w / 2)) / 2 - t.x
        roads.push(x - 0.1, ry, zA, x - 0.1, ry, zB, x + 0.1, ry, zA, x + 0.1, ry, zB)
      }
    }
    const roadLines = new THREE.LineSegments(segGeo(roads), new THREE.LineDashedMaterial({ color: INK, transparent: true, opacity: 0.38, dashSize: 0.55, gapSize: 0.3, fog: true }))
    roadLines.computeLineDistances()
    extras.push({ obj: roadLines, base: 0.38 })

    // halo
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: accent, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false }))
    sprite.scale.set(t.w * 1.5, t.w * 1.5, 1)
    sprite.position.set(0, t.y + 0.5, 0)
    this.halos.push(sprite)

    group.add(ring, body, strataLines, face, side, baseUnit, dimRing, tickLines, brackets, roadLines, sprite)
    this.scene.add(group)
    this.pickables.push(face)
    this.nodes.set(t.id, { placed: t, group, lines: body, fill: face, pick: face, baseOpacity: 0.38, targetOpacity: 1, accentLines: ring, extras })
    this.addLabel(t.id, new THREE.Vector3(t.x - t.w * 0.18, t.y + 0.05, t.z - t.d / 2 + 0.9), 1, 3)

    for (const pad of t.children) this.buildPad(pad, accent)
  }

  private buildPad(p: Placed, accent: THREE.Color) {
    const group = new THREE.Group()
    const outline = roundedRectPoints(p.w, p.d, 0.5)
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(outline), this.lineMat(accent, 0.42))
    ring.position.set(p.x, p.y + p.h, p.z)
    const body = new THREE.LineSegments(extrudeOutline(outline, p.h, 3), this.lineMat(INK, 0.3))
    body.position.set(p.x, p.y + p.h, p.z)
    const shape = new THREE.Shape()
    outline.forEach((q, i) => (i === 0 ? shape.moveTo(q.x, -q.z) : shape.lineTo(q.x, -q.z)))
    const faceGeo = new THREE.ShapeGeometry(shape)
    faceGeo.rotateX(-Math.PI / 2)
    // district floor: dark plate with a fine block-pitch grid and a soft centre — each subsection reads as its own tile;
    // uFocus lifts the plate and tints its edge with the accent while the district is the focus
    const floorMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: true,
      uniforms: { uSize: { value: new THREE.Vector2(p.w, p.d) }, uFocus: { value: 0 }, uAccent: { value: ACCENT.clone() }, uTint: { value: accent.clone() } },
      vertexShader: /* glsl */ `varying vec2 vL; void main(){ vL = vec2(position.x, -position.z); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec2 uSize; uniform float uFocus; uniform vec3 uAccent; uniform vec3 uTint; varying vec2 vL;
        float gridLine(vec2 p, float s){ vec2 r = p / s; vec2 g = abs(fract(r - 0.5) - 0.5) / fwidth(r); return 1.0 - min(min(g.x, g.y), 1.0); }
        void main(){
          vec2 q = vL / (uSize * 0.5);              // -1..1 across the pad
          float edge = 1.0 - max(abs(q.x), abs(q.y)); // 0 at rim, 1 at centre
          vec3 base = vec3(0.063, 0.078, 0.122);
          float centre = smoothstep(0.0, 1.0, edge) * 0.55;
          vec3 col = base + vec3(0.02, 0.025, 0.04) * centre;
          float g = gridLine(vL + uSize * 0.5, 1.15) * 0.07;
          col += vec3(g);
          // accent rim while focused
          float rim = smoothstep(0.075, 0.0, edge) * uFocus;
          col = mix(col, uAccent * 0.5, rim * 0.42);
          col = mix(col, uTint * 0.22, (1.0 - edge) * 0.08);
          gl_FragColor = vec4(col, 0.92);
        }`,
    })
    const face = new THREE.Mesh(faceGeo, floorMat)
    face.position.set(p.x, p.y + p.h - 0.005, p.z)
    face.renderOrder = 2
    face.userData.id = p.id
    face.userData.level = 2
    this.pickables.push(face)
    this.padFloors.set(p.id, floorMat)
    const extras: Node['extras'] = []
    // inset plate (curb) on every district, stronger on weighted ones
    const heavy = (p.entity.layout?.weight ?? 1) > 1
    const inner = new THREE.Line(new THREE.BufferGeometry().setFromPoints(roundedRectPoints(p.w - 0.5, p.d - 0.5, 0.35)), this.lineMat(accent, heavy ? 0.28 : 0.16))
    inner.position.set(p.x, p.y + p.h + 0.005, p.z)
    group.add(inner)
    extras.push({ obj: inner, base: heavy ? 0.28 : 0.16 })
    // corner brackets — the same plan-drawing mark the territory has, at district scale
    const br: number[] = []
    const o = 0.22, L = 0.7, hw = p.w / 2 + o, hd = p.d / 2 + o
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      br.push(sx * hw, 0, sz * hd, sx * (hw - L), 0, sz * hd)
      br.push(sx * hw, 0, sz * hd, sx * hw, 0, sz * (hd - L))
    }
    const brackets = new THREE.LineSegments(segGeo(br), this.lineMat(accent, 0.38))
    brackets.position.set(p.x, p.y + p.h + 0.004, p.z)
    group.add(brackets)
    extras.push({ obj: brackets, base: 0.38 })
    // type zones (subsections): dashed plate per zone + a caption label shown while the district is the focus
    const zs: number[] = []
    for (const zn of p.zones ?? []) {
      const zw = zn.w + 0.22, zd = zn.d + 0.22
      const zo = roundedRectPoints(zw, zd, 0.18)
      for (let i = 0; i < zo.length - 1; i++) zs.push(zn.x - p.x + zo[i].x, 0, zn.z - p.z + zo[i].z, zn.x - p.x + zo[i + 1].x, 0, zn.z - p.z + zo[i + 1].z)
    }
    const zonesLines = new THREE.LineSegments(segGeo(zs), new THREE.LineDashedMaterial({ color: INK, transparent: true, opacity: 0.22, dashSize: 0.18, gapSize: 0.12, fog: true }))
    zonesLines.computeLineDistances()
    zonesLines.position.set(p.x, p.y + p.h + 0.01, p.z)
    group.add(zonesLines)
    extras.push({ obj: zonesLines, base: 0.22 })

    // diagonal hatch over the pad top — shown only while this district is the focus
    const hs: number[] = []
    const hhw = p.w / 2 - 0.25, hhd = p.d / 2 - 0.25, step = 0.42
    for (const c = { v: -(hhw + hhd) }; c.v <= hhw + hhd; c.v += step) {
      const pts: [number, number][] = []
      const tryPt = (x: number, z: number) => { if (x >= -hhw - 1e-6 && x <= hhw + 1e-6 && z >= -hhd - 1e-6 && z <= hhd + 1e-6) pts.push([x, z]) }
      tryPt(-hhw, -hhw - c.v); tryPt(hhw, hhw - c.v); tryPt(-hhd + c.v, -hhd); tryPt(hhd + c.v, hhd)
      if (pts.length >= 2) hs.push(pts[0][0], 0, pts[0][1], pts[1][0], 0, pts[1][1])
    }
    const hatch = new THREE.LineSegments(segGeo(hs), this.lineMat(accent, 0))
    hatch.position.set(p.x, p.y + p.h + 0.012, p.z)
    group.add(hatch)
    this.hatches.set(p.id, hatch)
    group.add(ring, body, face)
    this.scene.add(group)
    this.nodes.set(p.id, { placed: p, group, lines: body, fill: face, pick: face, baseOpacity: 0.3, targetOpacity: 1, accentLines: ring, extras })
    this.addLabel(p.id, new THREE.Vector3(p.x, p.y + p.h + 0.05, p.z - p.d / 2 + 0.35), 2, 2)
    for (const zn of p.zones ?? []) this.addZoneLabel(p.id, zn)
    for (const el of p.children) this.buildBlock(el)
  }

  // ---------- buildings by type ----------
  // Each type has a silhouette, a plinth on the floor and a rooftop glyph, so it reads at small size in wireframe:
  //   workflow    tower with floors, spine, antenna + pennant (a process that runs)
  //   capability  stepped block with a notch and a ridge mark (a tool the team can use)
  //   control     portal frame with a barrier bar and a diamond sign (a gate a human holds)
  //   deliverable stack of plates with a tab (a thing that was produced)
  //   connection  cylinder with a socket ring and an aerial (an external service)

  private buildBlock(el: Placed) {
    const e = el.entity
    const st = this.stateStyle(e.state)
    const group = new THREE.Group()
    const extras: Node['extras'] = []
    let lines: THREE.LineSegments | THREE.Line
    let fill: THREE.Mesh | undefined
    const jitter = 0.86 + hash01(e.id) * 0.28
    const hero = (e.layout?.height ?? 1) >= 1.2
    const dim = e.state === 'retired' || e.state === 'parked'
    const tint = e.state === 'implemented' || e.state === 'experimental' ? (TYPE_TINT[e.type] ?? INK) : st.color

    // plinth on the floor — the type's footprint symbol
    const pl: number[] = []
    const py = 0.008
    switch (e.type) {
      case 'workflow': { rectSegments(0.86, 0.86, py, pl); for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { pl.push(sx * 0.43, py, sz * 0.43, sx * 0.3, py, sz * 0.43); pl.push(sx * 0.43, py, sz * 0.43, sx * 0.43, py, sz * 0.3) } break }
      case 'capability': { const r = 0.5; for (let i = 0; i < 8; i++) { const a0 = (i / 8) * Math.PI * 2 + Math.PI / 8, a1 = ((i + 1) / 8) * Math.PI * 2 + Math.PI / 8; pl.push(Math.cos(a0) * r, py, Math.sin(a0) * r, Math.cos(a1) * r, py, Math.sin(a1) * r) } break }
      case 'control': { circleSegments(0.5, py, 24, pl); for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; pl.push(Math.cos(a) * 0.5, py, Math.sin(a) * 0.5, Math.cos(a) * 0.62, py, Math.sin(a) * 0.62) } break }
      case 'deliverable': { rectSegments(0.92, 0.74, py, pl); pl.push(-0.46, py, -0.37, -0.3, py, -0.37, -0.3, py, -0.37, -0.3, py, -0.28, -0.3, py, -0.28, -0.46, py, -0.28); break }
      default: { circleSegments(0.42, py, 20, pl); circleSegments(0.52, py, 20, pl) }
    }
    const plinth = new THREE.LineSegments(segGeo(pl), this.lineMat(tint, dim ? 0.12 : 0.26))
    plinth.position.set(el.x, el.y, el.z)
    group.add(plinth)
    extras.push({ obj: plinth, base: dim ? 0.12 : 0.26 })

    if (e.state === 'proposed') {
      const pts = roundedRectPoints(el.w, el.d, 0.08)
      lines = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.lineMat(st.color, st.opacity, true))
      lines.computeLineDistances()
      lines.position.set(el.x, el.y + 0.02, el.z)
    } else {
      const geos: THREE.BufferGeometry[] = []
      const floors: number[] = []
      const glyph: number[] = []
      let fillGeo: THREE.BufferGeometry
      let fillY = 0
      const h = el.h * jitter
      switch (e.type) {
        case 'workflow': {
          const w = 0.54, d = 0.54
          geos.push(boxEdges(w, h, d).translate(0, h / 2, 0))
          for (let y = 0.24; y < h - 0.08; y += 0.24) rectSegments(w, d, y, floors)
          // spine + antenna + pennant
          const ah = hero ? 0.62 : 0.34
          glyph.push(0, h, 0, 0, h + ah, 0)
          glyph.push(0, h + ah, 0, 0.16, h + ah - 0.08, 0, 0.16, h + ah - 0.08, 0, 0, h + ah - 0.16, 0)
          if (hero) {
            floors.push(-w / 2, 0, d / 2, w / 2, h, d / 2, w / 2, 0, d / 2, -w / 2, h, d / 2)
            floors.push(w / 2, 0, -d / 2, w / 2, h, d / 2, w / 2, 0, d / 2, w / 2, h, -d / 2)
          }
          fillGeo = new THREE.BoxGeometry(w * 0.98, h * 0.98, d * 0.98); fillY = h / 2
          el.h = h + ah
          break
        }
        case 'capability': {
          const w = 0.64, d = 0.64, h1 = h * 0.72, h2 = h - h1
          geos.push(boxEdges(w, h1, d).translate(0, h1 / 2, 0))
          geos.push(boxEdges(w * 0.6, h2, d * 0.6).translate(0.04, h1 + h2 / 2, -0.04))
          for (let y = 0.24; y < h1 - 0.06; y += 0.24) rectSegments(w, d, y, floors)
          // notch on the front face + ridge mark on the cap
          glyph.push(-0.1, h1 * 0.35, d / 2 + 0.001, 0.1, h1 * 0.35, d / 2 + 0.001, -0.1, h1 * 0.55, d / 2 + 0.001, 0.1, h1 * 0.55, d / 2 + 0.001)
          glyph.push(0.04 - w * 0.3, h + 0.001, -0.04, 0.04, h + 0.12, -0.04, 0.04, h + 0.12, -0.04, 0.04 + w * 0.3, h + 0.001, -0.04)
          fillGeo = new THREE.BoxGeometry(w * 0.98, h1 * 0.98, d * 0.98); fillY = h1 / 2
          el.h = h + 0.12
          break
        }
        case 'control': {
          const w = 0.74, d = 0.74, hs = 0.1
          geos.push(boxEdges(w, hs, d).translate(0, hs / 2, 0))
          const gh = Math.max(h, 0.45)
          // portal: two posts + lintel, barrier bar, diamond sign above
          const px = 0.28
          glyph.push(-px, hs, 0, -px, hs + gh, 0, px, hs, 0, px, hs + gh, 0, -px, hs + gh, 0, px, hs + gh, 0)
          glyph.push(-px, hs + gh * 0.45, 0, px, hs + gh * 0.45, 0)
          const dy = hs + gh + 0.22, ds = 0.11
          glyph.push(0, dy + ds, 0, ds, dy, 0, ds, dy, 0, 0, dy - ds, 0, 0, dy - ds, 0, -ds, dy, 0, -ds, dy, 0, 0, dy + ds, 0)
          glyph.push(0, hs + gh, 0, 0, dy - ds, 0)
          fillGeo = new THREE.BoxGeometry(w * 0.98, hs, d * 0.98); fillY = hs / 2
          el.h = dy + ds
          break
        }
        case 'deliverable': {
          const w = 0.78, d = 0.6, ph = 0.07
          const n = Math.max(2, Math.round(h / 0.15))
          for (let i = 0; i < n; i++) geos.push(boxEdges(w - i * 0.06, ph, d - i * 0.05).translate(i * 0.03, ph / 2 + i * (ph + 0.03), -i * 0.02))
          // tab on the top plate
          const top = n * (ph + 0.03) - 0.03, tx = (n - 1) * 0.03, tz = -(n - 1) * 0.02
          const tw = (w - (n - 1) * 0.06) / 2, td = (d - (n - 1) * 0.05) / 2
          glyph.push(tx - tw, top + 0.001, tz - td, tx - tw + 0.22, top + 0.001, tz - td, tx - tw + 0.22, top + 0.001, tz - td, tx - tw + 0.22, top + 0.001, tz - td + 0.12, tx - tw + 0.22, top + 0.001, tz - td + 0.12, tx - tw, top + 0.001, tz - td + 0.12)
          fillGeo = new THREE.BoxGeometry(w * 0.98, ph, d * 0.98); fillY = ph / 2
          el.h = n * (ph + 0.03)
          break
        }
        default: {
          const rad = 0.3, ch = Math.max(h, 0.3)
          geos.push(new THREE.EdgesGeometry(new THREE.CylinderGeometry(rad, rad, ch, 10), 1).translate(0, ch / 2, 0))
          circleSegments(rad, ch * 0.5, 10, floors)
          // socket ring above + aerial
          circleSegments(rad * 0.7, ch + 0.1, 12, glyph)
          glyph.push(0, ch, 0, 0, ch + 0.28, 0)
          fillGeo = new THREE.CylinderGeometry(rad * 0.98, rad * 0.98, ch * 0.98, 10); fillY = ch / 2
          el.h = ch + 0.28
        }
      }
      const merged = mergeGeometries(geos, false)!
      lines = new THREE.LineSegments(merged, this.lineMat(tint, st.opacity, st.dashed))
      if (st.dashed) lines.computeLineDistances()
      lines.position.set(el.x, el.y, el.z)
      if (floors.length) {
        const fop = st.opacity * (dim ? 0.5 : 0.42)
        const fl = new THREE.LineSegments(segGeo(floors), this.lineMat(tint, fop))
        fl.position.copy(lines.position)
        group.add(fl)
        extras.push({ obj: fl, base: fop })
      }
      if (glyph.length) {
        const gop = st.opacity * (dim ? 0.55 : 0.95)
        const gl = new THREE.LineSegments(segGeo(glyph), this.lineMat(dim ? tint : ACCENT_HI.clone().lerp(tint, 0.55), gop))
        gl.position.copy(lines.position)
        group.add(gl)
        extras.push({ obj: gl, base: gop })
      }
      // top light: faces brighten with height so the block reads as a volume, not a flat cut-out
      shadeByHeight(fillGeo, 0x0a0d16, 0x1a2030)
      fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: st.fill, depthWrite: true }))
      fill.position.set(el.x, el.y + fillY, el.z)
      fill.renderOrder = 3
      if (hero && !dim) {
        // beacon on the tallest workflows — a small additive light, the "this one runs the place" mark
        const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: ACCENT_HI, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }))
        beacon.scale.set(0.9, 0.9, 1)
        beacon.position.set(el.x, el.y + el.h, el.z)
        group.add(beacon)
        this.beacons.push(beacon)
      }
    }
    const pg = new THREE.BoxGeometry(el.w, Math.max(el.h, 0.3), el.d)
    const pick = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ visible: false }))
    pick.position.set(el.x, el.y + Math.max(el.h, 0.3) / 2, el.z)
    pick.userData.id = el.id
    pick.userData.level = 3
    this.pickables.push(pick)
    group.add(lines, pick)
    if (fill) group.add(fill)
    this.scene.add(group)
    this.nodes.set(el.id, { placed: el, group, lines, fill, pick, baseOpacity: st.opacity, targetOpacity: 1, extras })
    const prio = e.type === 'workflow' ? 3 : e.type === 'control' ? 2 : 1
    this.addLabel(el.id, new THREE.Vector3(el.x, el.y + el.h + 0.08, el.z), 3, prio + (hero ? 2 : 0))
  }

  private zoneLabels: { pad: string; el: HTMLDivElement; anchor: THREE.Vector3; alts: THREE.Vector3[]; bw?: number; bh?: number }[] = []
  private addZoneLabel(padId: string, zn: { type: string; x: number; z: number; w: number; d: number; n: number }) {
    const el = document.createElement('div')
    el.className = `zlbl zt-${zn.type}`
    el.textContent = `${ZONE_NAME[zn.type] ?? zn.type} · ${zn.n}`
    this.labelRoot.appendChild(el)
    const pad = this.nodes.get(padId)!.placed
    const y = pad.y + pad.h + 0.02
    // candidate anchors: back-left, front-left, back-right, front-right corners of the zone plate
    const alts = [
      new THREE.Vector3(zn.x - zn.w / 2 + 0.1, y, zn.z - zn.d / 2 - 0.16),
      new THREE.Vector3(zn.x - zn.w / 2 + 0.1, y, zn.z + zn.d / 2 + 0.3),
      new THREE.Vector3(zn.x + zn.w / 2 - 0.1, y, zn.z - zn.d / 2 - 0.16),
      new THREE.Vector3(zn.x + zn.w / 2 - 0.1, y, zn.z + zn.d / 2 + 0.3),
    ]
    this.zoneLabels.push({ pad: padId, el, anchor: alts[0], alts })
  }

  private addLabel(id: string, anchor: THREE.Vector3, level: 1 | 2 | 3, priority: number) {
    const e = this.entities.get(id)!
    const el = document.createElement('div')
    el.className = `lbl lbl-l${level} st-${e.state}`
    el.dataset.id = id
    const name = document.createElement('span')
    name.className = 'lbl-name'
    name.textContent = level === 3 ? shorten(e.name, 34) : e.name
    if (level === 3 && e.name.length > 34) el.title = e.name
    el.setAttribute('role', 'button')
    el.appendChild(name)
    if (level < 3 && e.kind) {
      const k = document.createElement('span')
      k.className = 'lbl-kind'
      k.textContent = level === 1 ? e.kind : shorten(e.kind, 26)
      el.appendChild(k)
    }
    el.addEventListener('click', (ev) => { ev.stopPropagation(); this.events.onPick(id, level) })
    el.addEventListener('pointerenter', () => { if (this.hovered !== id) { this.hovered = id; this.updateHoverMark(); this.events.onHover(id) } })
    el.addEventListener('pointerleave', () => { if (this.hovered === id) { this.hovered = null; this.hoverMark.visible = false; this.events.onHover(null) } })
    this.labelRoot.appendChild(el)
    this.labels.push({ id, el, anchor, level, priority })
  }

  // ---------- relations (Ganges: bright ends, pins, landing dots) ----------

  private endpointOf(id: string): THREE.Vector3 | null {
    const n = this.nodes.get(id)
    if (!n) return null
    const p = n.placed
    if (p.level === 3) return new THREE.Vector3(p.x, p.y + p.h + 0.05, p.z)
    if (p.level === 2) return new THREE.Vector3(p.x, p.y + 0.3, p.z)
    return new THREE.Vector3(p.x, p.y + 1.2, p.z)
  }

  private relationLine(r: Relation): RelObj | null {
    const cached = this.relationObjects.get(r.id)
    if (cached) return cached
    const a0 = this.endpointOf(r.from), b0 = this.endpointOf(r.to)
    if (!a0 || !b0) return null
    const dist = a0.distanceTo(b0)
    const pin = clamp(dist * 0.06, 0.5, 2.2)
    const a = a0.clone().setY(a0.y + pin), b = b0.clone().setY(b0.y + pin)
    const lift = clamp(dist * 0.18, 0.4, 9)
    const pts = arcPoints(a, b, lift, 48)
    const g = new THREE.BufferGeometry().setFromPoints(pts)
    const cols: number[] = []
    for (let i = 0; i < pts.length; i++) { const t = i / (pts.length - 1); const k = 0.28 + 0.72 * Math.pow(Math.abs(t - 0.5) * 2, 1.4); cols.push(k, k, k) }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
    const inferred = r.verification === 'inferred'
    const arc = new THREE.Line(
      g,
      inferred
        ? new THREE.LineDashedMaterial({ color: ACCENT_DIM, vertexColors: true, transparent: true, opacity: 0.6, dashSize: 0.5, gapSize: 0.4, fog: true })
        : new THREE.LineBasicMaterial({ color: ACCENT, vertexColors: true, transparent: true, opacity: 0.95, fog: true }),
    )
    if (inferred) arc.computeLineDistances()
    arc.renderOrder = 5
    const pins = new THREE.LineSegments(segGeo([a0.x, a0.y, a0.z, a.x, a.y, a.z, b0.x, b0.y, b0.z, b.x, b.y, b.z]), new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.55, fog: true }))
    pins.renderOrder = 5
    const dots = new THREE.Points(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.PointsMaterial({ color: ACCENT_HI, size: 5, sizeAttenuation: false, transparent: true, opacity: 0.95, map: glowTexture(), depthWrite: false }))
    dots.renderOrder = 6
    // packets travelling along the route (Mini Metro trains): two per arc, half a lap apart
    const packets = new THREE.Points(new THREE.BufferGeometry().setFromPoints([pts[0].clone(), pts[Math.floor(pts.length / 2)].clone()]), new THREE.PointsMaterial({ color: ACCENT_HI, size: 4, sizeAttenuation: false, transparent: true, opacity: 0.9, map: glowTexture(), depthWrite: false, blending: THREE.AdditiveBlending }))
    packets.renderOrder = 6
    for (const o of [arc, pins, dots, packets]) { o.visible = false; this.scene.add(o) }
    const obj: RelObj = { arc, pins, dots, packets, pts, revealAt: -1, seed: hash01(r.id) }
    this.relationObjects.set(r.id, obj)
    return obj
  }

  private territoryOf(id: string): string | null {
    let e = this.entities.get(id)
    while (e && e.type !== 'territory') e = e.parentId ? this.entities.get(e.parentId) : undefined
    return e ? e.id : null
  }
  private projectOf(id: string): string | null {
    let e = this.entities.get(id)
    while (e && e.type !== 'project') e = e.parentId ? this.entities.get(e.parentId) : undefined
    return e ? e.id : null
  }

  private computeVisibleRelations(extra: string[]): Set<string> {
    const vis = new Set<string>(extra)
    const { level, id } = this.focus
    for (const r of this.data.relations) {
      const tf = this.territoryOf(r.from), tt = this.territoryOf(r.to)
      const pf = this.projectOf(r.from), pt = this.projectOf(r.to)
      if (level === 'territory') {
        if ((tf === id || tt === id) && pf !== pt) vis.add(r.id)
      } else if (level === 'project') {
        // inside a district: the routes that start or end in it and stay on this platform
        // (cross-platform routes fly off-screen here; they appear again at territory level and on each element)
        if ((pf === id || pt === id) && tf === tt) vis.add(r.id)
      } else if (level === 'element') {
        if (r.from === id || r.to === id) vis.add(r.id)
      }
    }
    return vis
  }

  // ---------- focus / styling ----------

  setFocus(focus: Focus, camera?: { azimuth?: number; elevation?: number; distance?: number }, duration = 1700) {
    this.focus = focus
    this.lastCam = camera
    this.selected = focus.level === 'element' ? focus.id : null
    this.flyTo(focus, camera, duration)
    this.applyFocusStyles()
  }

  setHighlight(ids: string[], relationIds: string[] = []) {
    this.highlight = new Set(ids)
    this.extraRelations = relationIds
    this.applyFocusStyles()
  }

  setFilter(fn: ((e: Entity) => boolean) | null) {
    this.filterFn = fn
    this.applyFocusStyles()
  }

  /** ids (at the current focus scope) that pass the active filter — for the legend counter */
  countFilter(fn: (e: Entity) => boolean): number {
    let n = 0
    for (const e of this.entities.values()) if (e.type !== 'world' && e.type !== 'territory' && e.type !== 'project' && fn(e)) n++
    return n
  }

  private flyTo(focus: Focus, cam?: { azimuth?: number; elevation?: number; distance?: number }, duration = 1700) {
    const aspect = this.camera.aspect
    let f: Framing
    if (focus.level === 'world') {
      const wb = worldBounds(this.layout.territories)
      f = this.director.fitBox(new THREE.Vector3(wb.cx, 1.5, wb.cz), wb.w * 1.02, wb.d * 1.02, cam?.elevation ?? deg(36), cam?.azimuth ?? 0.55, aspect, 1.28)
    } else {
      const n = this.nodes.get(focus.id)
      if (!n) return
      const p = n.placed
      if (p.level === 1) {
        f = this.director.fitBox(new THREE.Vector3(p.x, p.y + 0.6, p.z), p.w, p.d, cam?.elevation ?? deg(42), cam?.azimuth ?? territoryAzimuth(p.id), aspect, 1.22)
      } else if (p.level === 2) {
        const tid = this.territoryOf(p.id)!
        f = this.director.fitBox(new THREE.Vector3(p.x, p.y + 0.4, p.z), p.w, p.d, cam?.elevation ?? deg(40), cam?.azimuth ?? territoryAzimuth(tid) + 0.35, aspect, 1.8)
      } else {
        const pid = this.projectOf(p.id)!
        const pad = this.nodes.get(pid)!.placed
        const tid = this.territoryOf(p.id)!
        const base = this.director.fitBox(new THREE.Vector3(pad.x, pad.y + 0.4, pad.z), pad.w, pad.d, deg(34), territoryAzimuth(tid) + 0.35, aspect, 1.5)
        f = { target: new THREE.Vector3(p.x, p.y + p.h * 0.5, p.z), distance: Math.max(base.distance * 0.85, 14), azimuth: cam?.azimuth ?? base.azimuth + 0.25, elevation: cam?.elevation ?? deg(36) }
      }
    }
    if (cam?.distance) f.distance *= cam.distance
    // stage light + arrival pulse follow the subject (before the framing offsets)
    if (focus.level === 'world') { this.spotGoal.opacity = 0; this.spotGoal.scale = 60 }
    else {
      const n = this.nodes.get(focus.id)!, p = n.placed
      const surfY = p.level === 1 ? p.y : p.level === 2 ? p.y + p.h : p.y
      this.spotGoal.pos.set(p.x, surfY + 0.25, p.z)
      this.spotGoal.scale = p.level === 1 ? Math.max(p.w, p.d) * 1.7 : p.level === 2 ? Math.max(p.w, p.d) * 2.3 : 5.5
      this.spotGoal.opacity = p.level === 1 ? 0.14 : p.level === 2 ? 0.2 : 0.24
      if (!this.reducedMotion) {
        this.pulse.position.set(p.x, surfY + 0.06, p.z)
        this.pulseR = p.level === 1 ? Math.max(p.w, p.d) * 0.55 : p.level === 2 ? Math.max(p.w, p.d) * 0.6 : 0.6
        this.pulseT0 = performance.now() + Math.max(0, duration - 500)
        this.pulse.visible = true
      }
    }
    const lift = focus.level === 'world' ? 0.15 : focus.level === 'territory' ? 0.1 : 0.07
    const toCam = new THREE.Vector3(Math.sin(f.azimuth), 0, Math.cos(f.azimuth))
    f.target.add(toCam.multiplyScalar(f.distance * lift * Math.cos(f.elevation)))
    if (this.panelOpen && focus.level !== 'world') {
      const right = new THREE.Vector3(Math.cos(f.azimuth), 0, -Math.sin(f.azimuth))
      f.target.add(right.multiplyScalar(f.distance * 0.2 * Math.tan(deg(this.camera.fov) / 2) * this.camera.aspect))
    }
    this.director.flyTo(f, this.reducedMotion ? 0 : duration)
  }

  private applyFocusStyles() {
    const { level, id } = this.focus
    const focusTerritory = level === 'world' ? null : this.territoryOf(id)
    const focusProject = level === 'project' ? id : level === 'element' ? this.projectOf(id) : null
    for (const [nid, n] of this.nodes) {
      const p = n.placed
      let t = 1
      if (level === 'world') {
        t = p.level === 1 ? 1 : p.level === 2 ? 0.75 : 0.5
      } else if (level === 'territory') {
        const inT = this.territoryOf(nid) === focusTerritory
        t = inT ? (p.level === 3 ? 0.7 : 1) : 0.22
      } else {
        const inP = this.projectOf(nid) === focusProject
        const inT = this.territoryOf(nid) === focusTerritory
        t = inP ? 1 : inT ? 0.28 : 0.12
        if (level === 'element' && p.level === 3 && inP && nid !== id) t = 0.55
      }
      if (this.highlight.size && this.highlight.has(nid)) t = 1
      else if (this.highlight.size && p.level === 3 && this.projectOf(nid) === focusProject) t = Math.min(t, 0.45)
      if (this.filterFn && p.level === 3 && !this.filterFn(p.entity)) t = Math.min(t, 0.16)
      n.targetOpacity = t
    }
    const vis = this.computeVisibleRelations(this.extraRelations)
    const relOpacity = level === 'territory' ? 0.3 : level === 'project' ? 0.42 : 0.9
    const now = performance.now()
    for (const [rid, o] of this.relationObjects) if (!vis.has(rid)) o.arc.visible = o.pins.visible = o.dots.visible = o.packets.visible = false
    for (const rid of vis) {
      const r = this.relations.get(rid)
      if (!r) continue
      const o = this.relationLine(r)
      if (o) {
        const fresh = !this.visibleRelations.has(rid)
        o.arc.visible = o.pins.visible = o.dots.visible = o.packets.visible = true
        if (fresh) { o.revealAt = this.reducedMotion ? -1 : now + 250; o.arc.geometry.setDrawRange(0, this.reducedMotion ? Infinity : 0) }
        const base = r.verification === 'inferred' ? 0.6 : 1
        const k = relOpacity * base * (this.extraRelations.includes(rid) ? 1.1 : 1)
        ;(o.arc.material as THREE.Material).opacity = Math.min(1, k)
        ;(o.pins.material as THREE.Material).opacity = Math.min(1, k * 0.6)
        ;(o.dots.material as THREE.Material).opacity = Math.min(1, k)
        ;(o.packets.material as THREE.Material).opacity = Math.min(1, k)
      }
    }
    this.visibleRelations = vis
    this.updateSelMark()
    for (const z of this.zoneLabels) z.el.classList.toggle('lbl-on', z.pad === focusProject)
    let stagger = 0
    for (const l of this.labels) {
      const show =
        (level === 'world' && l.level === 1) ||
        (level === 'territory' && ((l.level === 2 && this.territoryOf(l.id) === focusTerritory) || (l.level === 1 && l.id !== focusTerritory))) ||
        ((level === 'project' || level === 'element') && ((l.level === 3 && this.projectOf(l.id) === focusProject) || (l.level === 2 && this.territoryOf(l.id) === focusTerritory && l.id !== focusProject))) ||
        this.highlight.has(l.id)
      if (show && !l.el.classList.contains('lbl-on')) l.el.style.transitionDelay = `${180 + (stagger++ % 12) * 45}ms`
      else if (!show) l.el.style.transitionDelay = '0ms'
      l.el.classList.toggle('lbl-on', show)
      l.el.classList.toggle('lbl-hi', this.highlight.has(l.id))
      l.el.classList.toggle('lbl-sel', l.id === this.selected)
      l.el.classList.toggle('lbl-ctx', (level === 'territory' && l.level === 1) || ((level === 'project' || level === 'element') && l.level === 2))
      l.el.classList.toggle('lbl-dim', !!this.filterFn && l.level === 3 && !this.filterFn(this.entities.get(l.id)!))
    }
  }

  get visibleRelationIds(): string[] { return [...this.visibleRelations] }

  // ---------- interaction ----------

  private downAt: { x: number; y: number; t: number } | null = null
  private dragging = false
  private lastPointer = { x: 0, y: 0 }

  private onPointerMove = (ev: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect()
    this.pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1)
    if (this.downAt && this.interactive) {
      const dx = ev.clientX - this.lastPointer.x, dy = ev.clientY - this.lastPointer.y
      if (Math.hypot(ev.clientX - this.downAt.x, ev.clientY - this.downAt.y) > 4) this.dragging = true
      if (this.dragging) {
        if (ev.shiftKey || ev.buttons === 4) {
          const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0)
          const fwd = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 2).negate()
          fwd.y = 0
          fwd.normalize()
          const k = this.director.current.distance * 0.0016
          this.director.nudge(0, 0, 0, right.multiplyScalar(-dx * k).add(fwd.multiplyScalar(dy * k)))
        } else {
          this.director.nudge(-dx * 0.005, dy * 0.004, 0)
        }
      }
      this.lastPointer = { x: ev.clientX, y: ev.clientY }
      return
    }
    const hit = this.pick()
    const id = hit?.id ?? null
    if (id !== this.hovered) {
      this.hovered = id
      this.canvas.style.cursor = id ? 'pointer' : 'default'
      this.updateHoverMark()
      this.events.onHover(id)
    }
  }
  private onPointerDown = (ev: PointerEvent) => {
    this.downAt = { x: ev.clientX, y: ev.clientY, t: performance.now() }
    this.lastPointer = { x: ev.clientX, y: ev.clientY }
    this.dragging = false
  }
  private onPointerUp = () => {
    const wasDrag = this.dragging
    this.downAt = null
    this.dragging = false
    if (wasDrag) return
    const hit = this.pick()
    this.events.onPick(hit?.id ?? null, hit?.level ?? 0)
  }
  private onWheel = (ev: WheelEvent) => {
    if (!this.interactive) return
    ev.preventDefault()
    this.director.nudge(0, 0, clamp(ev.deltaY * 0.0012, -0.25, 0.25))
  }

  private pick(): { id: string; level: 1 | 2 | 3 } | null {
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.pickables, false)
    if (!hits.length) return null
    const { level } = this.focus
    const allowed = level === 'world' ? 1 : level === 'territory' ? 2 : 3
    let best: { id: string; level: 1 | 2 | 3 } | null = null
    for (const h of hits) {
      const l = h.object.userData.level as 1 | 2 | 3
      const id = h.object.userData.id as string
      if (l > allowed) continue
      if (!best || l > best.level) best = { id, level: l }
    }
    if (!best && level === 'territory') {
      const h = hits.find((x) => x.object.userData.level === 3)
      if (h) { const pid = this.projectOf(h.object.userData.id); if (pid) best = { id: pid, level: 2 } }
    }
    return best
  }

  // ---------- loop ----------

  private tmpV = new THREE.Vector3()
  private loop = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    const dt = Math.min(64, now - this.last)
    this.last = now
    this.director.orbitSpeed = this.paused || this.reducedMotion || this.focus.level !== 'world' || this.downAt ? 0 : 0.028
    this.director.update(dt)
    const k = this.reducedMotion ? 1 : 1 - Math.pow(0.001, dt / 1000)
    for (const n of this.nodes.values()) {
      const cur = (n.lines.material as THREE.Material).opacity / n.baseOpacity
      const next = cur + (n.targetOpacity - cur) * k
      ;(n.lines.material as THREE.Material).opacity = n.baseOpacity * next
      if (n.accentLines) (n.accentLines.material as THREE.Material).opacity = (n.placed.level === 1 ? 0.9 : 0.55) * Math.max(next, 0.35)
      if (n.extras) for (const x of n.extras) ((x.obj as THREE.Line).material as THREE.Material).opacity = x.base * Math.max(next, n.placed.level === 1 ? 0.5 : 0.25)
      if (n.fill && n.placed.level === 3) (n.fill.material as THREE.Material).opacity = this.stateStyle(n.placed.entity.state).fill * (0.55 + 0.45 * next)
    }
    const fp = this.focus.level === 'project' ? this.focus.id : this.focus.level === 'element' ? this.projectOf(this.focus.id) : null
    for (const [pid, hz] of this.hatches) { const m = hz.material as THREE.Material; const tgt = pid === fp ? 0.08 : 0; m.opacity += (tgt - m.opacity) * k }
    const breathe = this.paused || this.reducedMotion ? 0 : Math.sin(now / 2600) * 0.03
    for (const h of this.halos) (h.material as THREE.SpriteMaterial).opacity = (this.focus.level === 'world' ? 0.14 : 0.06) + breathe
    for (const b of this.beacons) (b.material as THREE.SpriteMaterial).opacity = 0.42 + (this.paused || this.reducedMotion ? 0.1 : 0.18 * (0.5 + 0.5 * Math.sin(now / 900 + b.position.x)))
    // district floors: accent rim while focused
    for (const [pid, m] of this.padFloors) { const tgt = pid === fp ? 1 : 0; m.uniforms.uFocus.value += (tgt - m.uniforms.uFocus.value) * k }
    // stage light follows the subject
    const sm = this.spot.material as THREE.SpriteMaterial
    this.spot.position.lerp(this.spotGoal.pos, k)
    const sc = this.spot.scale.x + (this.spotGoal.scale - this.spot.scale.x) * k
    this.spot.scale.set(sc, sc, 1)
    sm.opacity += (this.spotGoal.opacity - sm.opacity) * k
    // arrival pulse
    if (this.pulseT0 >= 0 && now >= this.pulseT0) {
      const pk = (now - this.pulseT0) / 1100
      if (pk >= 1) { this.pulse.visible = false; this.pulseT0 = -1 }
      else { const e = easeOutQuint(pk); const r = this.pulseR * (0.6 + 1.6 * e); this.pulse.scale.set(r, 1, r); (this.pulse.material as THREE.Material).opacity = (1 - pk) * 0.7 }
    }
    // selection ring breathes
    if (this.selMark.visible) (this.selMark.material as THREE.Material).opacity = 0.55 + (this.paused || this.reducedMotion ? 0.2 : 0.35 * (0.5 + 0.5 * Math.sin(now / 700)))
    // routes: draw-on reveal + travelling packets
    const moving = !this.paused && !this.reducedMotion
    for (const rid of this.visibleRelations) {
      const o = this.relationObjects.get(rid)
      if (!o) continue
      const n = o.pts.length
      if (o.revealAt >= 0) {
        const rk = (now - o.revealAt) / 750
        if (rk >= 1) { o.arc.geometry.setDrawRange(0, Infinity); o.revealAt = -1 }
        else { o.arc.geometry.setDrawRange(0, Math.max(0, Math.floor(easeOutQuint(Math.max(0, rk)) * n))) }
      }
      const pa = o.packets.geometry.attributes.position as THREE.BufferAttribute
      for (let j = 0; j < 2; j++) {
        const t = moving ? ((now / 1000) * 0.09 + o.seed + j * 0.5) % 1 : (0.3 + j * 0.4)
        const idx = Math.min(n - 1, Math.floor(t * (n - 1)))
        const q = o.pts[idx]
        pa.setXYZ(j, q.x, q.y, q.z)
      }
      pa.needsUpdate = true
    }
    // dust drift
    if (this.dust && moving) {
      const pa = this.dust.geometry.attributes.position as THREE.BufferAttribute
      const arr = pa.array as Float32Array
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] += this.dustVel[i] * dt; arr[i + 1] += this.dustVel[i + 1] * dt; arr[i + 2] += this.dustVel[i + 2] * dt
        if (arr[i + 1] > 28) arr[i + 1] = 0.5
      }
      pa.needsUpdate = true
    }
    this.renderer.render(this.scene, this.camera)
    this.updateLabels()
  }

  private updateHoverMark() {
    const n = this.hovered ? this.nodes.get(this.hovered) : null
    const allowed = this.focus.level === 'world' ? 1 : this.focus.level === 'territory' ? 2 : 3
    if (!n || n.placed.level !== allowed) { this.hoverMark.visible = false; return }
    const p = n.placed
    const y = p.level === 1 ? p.y + 0.03 : p.level === 2 ? p.y + p.h + 0.02 : p.y + 0.015
    const o = p.level === 3 ? 0.2 : p.level === 2 ? 0.4 : 0.9
    const hw = p.w / 2 + o, hd = p.d / 2 + o, L = Math.min(hw, hd) * (p.level === 3 ? 0.45 : 0.25)
    const seg: number[] = []
    // double bracket (offset copy) so it reads thicker than a 1 px line
    for (const off of [0, 0.07]) for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const w2 = hw + off, d2 = hd + off
      seg.push(sx * w2, 0, sz * d2, sx * (w2 - L), 0, sz * d2)
      seg.push(sx * w2, 0, sz * d2, sx * w2, 0, sz * (d2 - L))
    }
    this.hoverMark.geometry.dispose()
    this.hoverMark.geometry = segGeo(seg)
    this.hoverMark.position.set(p.x, y, p.z)
    this.hoverMark.visible = true
  }

  private selTinted: Node | null = null
  private updateSelMark() {
    const n = this.selected ? this.nodes.get(this.selected) : null
    // restore the previous selection's colour, tint the new one with the accent (Hades: selection = brightness + colour, no chrome)
    if (this.selTinted && this.selTinted !== n) { const m = this.selTinted.lines.material as THREE.LineBasicMaterial; if (this.selTinted.group.userData.baseColor) m.color.copy(this.selTinted.group.userData.baseColor); this.selTinted = null }
    if (n && n.placed.level === 3 && this.selTinted !== n) {
      const m = n.lines.material as THREE.LineBasicMaterial
      if (!n.group.userData.baseColor) n.group.userData.baseColor = m.color.clone()
      m.color.copy(ACCENT_HI)
      this.selTinted = n
    }
    if (!n) { this.selMark.visible = false; return }
    const p = n.placed
    this.selMark.geometry.dispose()
    this.selMark.geometry = new THREE.BufferGeometry().setFromPoints(roundedRectPoints(p.w + 0.5, p.d + 0.5, 0.14))
    this.selMark.position.set(p.x, p.y + 0.02, p.z)
    this.selMark.visible = true
  }

  private hideLabel(l: LabelEl, why: string) {
    l.el.dataset.why = why
    if (l.shown !== false) { l.el.classList.add('hid'); l.shown = false }
  }
  private measure(l: LabelEl) {
    if (l.bw === undefined || l.bh === undefined || l.bw === 0) { l.bw = l.el.offsetWidth || 80; l.bh = l.el.offsetHeight || 18 }
    return { bw: l.bw, bh: l.bh }
  }

  private placedRects: { x: number; y: number; w: number; h: number }[] = []
  private updateLabels() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight
    this.placedRects.length = 0
    const on = this.labels.filter((l) => l.el.classList.contains('lbl-on'))
    const rank = (l: LabelEl) => (l.level === 1 ? 4 : l.el.classList.contains('lbl-sel') ? 3 : l.el.classList.contains('lbl-hi') ? 2 : l.id === this.hovered ? 1 : l.el.classList.contains('lbl-dim') ? -1 : 0)
    on.sort((a, b) => rank(b) - rank(a) || a.level - b.level || b.priority - a.priority)
    const camPos = this.camera.position
    const cap3 = this.focus.level === 'element' ? 10 : 20
    let placed3 = 0
    const lead = (lv: number) => (lv === 1 ? 54 : lv === 2 ? 26 : 10)
    for (const l of on) {
      this.tmpV.copy(l.anchor).project(this.camera)
      const behind = this.tmpV.z > 1
      const x = (this.tmpV.x * 0.5 + 0.5) * w
      const anchorY = (-this.tmpV.y * 0.5 + 0.5) * h
      const bh0 = this.measure(l).bh
      // keep labels out of the top chrome: push down and stretch the leader to the anchor
      // the top chrome is empty between the brand block (left) and the toolbar (right): territory names may climb into that band
      const centreBand = x > 640 && x < w - 660
      // brand + crumbs occupy the top-left corner down to ~100 px; the toolbar the top-right down to ~60 px
      const topSafe = l.level === 1 ? (centreBand ? 66 : 118) : x < 700 ? 112 : 100
      let leadPx = lead(l.level)
      let y = anchorY - leadPx
      let flip = false
      if (y - bh0 < topSafe) {
        if (anchorY - bh0 > topSafe + 6) { y = topSafe + bh0; leadPx = Math.max(6, anchorY - y) }
        else { flip = true; y = Math.max(anchorY + leadPx + bh0, topSafe + bh0); leadPx = Math.max(6, y - bh0 - anchorY) } // no room above: hang the label below its anchor, never under the chrome
      }
      l.el.classList.toggle('lbl-flip', flip)
      // a flipped label whose anchor sits under the chrome keeps its text but drops the leader + dot (they would draw over the brand)
      l.el.classList.toggle('lbl-noanchor', flip && anchorY < topSafe - 8)
      l.el.style.setProperty('--lead', `${Math.round(leadPx)}px`)
      const dist = l.anchor.distanceTo(camPos)
      const isHi = l.el.classList.contains('lbl-hi') || l.el.classList.contains('lbl-sel')
      // "far" is relative to the current framing, not absolute: a big district pushes the camera back and must keep its labels
      const cd = this.director.current.distance
      const far = !isHi && (l.level === 3 ? dist > Math.max(70, cd * 1.7) : l.level === 2 ? dist > Math.max(160, cd * 2.4) : dist > 400)
      if (behind || far || x < -200 || x > w + 200 || y < -100 || y > h + 100) { this.hideLabel(l, far ? `far:${dist.toFixed(0)}/${cd.toFixed(0)}` : behind ? 'behind' : 'off'); continue }
      const { bw, bh } = this.measure(l)
      // keep territory / project labels inside the viewport horizontally
      const xc = l.level < 3 ? clamp(x, bw / 2 + 12, w - bw / 2 - 12) : x
      const priority = isHi || l.id === this.hovered || l.level === 1
      if (l.level === 3 && !priority && placed3 >= cap3) { this.hideLabel(l, 'cap'); continue }
      const hit = (r: { x: number; y: number; w: number; h: number }) => this.placedRects.some((q) => r.x < q.x + q.w + 6 && r.x + r.w + 6 > q.x && r.y < q.y + q.h + 2 && r.y + r.h + 2 > q.y)
      // candidates: territory / project labels never just vanish — they try below the anchor, then a sideways nudge
      const cands: { x: number; y: number; flip: boolean; lead: number }[] = [{ x: xc, y, flip, lead: leadPx }]
      if (l.level < 3) {
        const below = anchorY + lead(l.level) + bh
        cands.push({ x: xc, y: below, flip: true, lead: lead(l.level) })
        if (l.level === 1) {
          const dx = bw * 0.55
          cands.push({ x: clamp(xc - dx, bw / 2 + 12, w - bw / 2 - 12), y, flip, lead: leadPx }, { x: clamp(xc + dx, bw / 2 + 12, w - bw / 2 - 12), y, flip, lead: leadPx })
          cands.push({ x: xc, y: y + bh + 8, flip, lead: leadPx + bh + 8 })
        }
      }
      let pick: (typeof cands)[number] | null = null
      for (const c of cands) { const r = { x: c.x - bw / 2, y: c.y - bh, w: bw, h: bh + c.lead }; if (!hit(r)) { pick = c; this.placedRects.push(r); break } }
      if (!pick) { this.hideLabel(l, 'col'); continue }
      l.el.dataset.why = 'ok'
      if (l.level === 3 && !priority) placed3++
      l.el.classList.toggle('lbl-flip', pick.flip)
      l.el.style.setProperty('--lead', `${Math.round(pick.lead)}px`)
      if (l.shown !== true) { l.el.classList.remove('hid'); l.shown = true }
      l.el.style.transform = `translate3d(${Math.round(pick.x)}px, ${Math.round(pick.y)}px, 0) translate(-50%, -100%)`
    }
    for (const l of this.labels) if (!l.el.classList.contains('lbl-on')) this.hideLabel(l, 'off')
    // zone captions go last and yield to element labels: try each corner of the zone plate, keep the first free one
    for (const z of this.zoneLabels) {
      if (!z.el.classList.contains('lbl-on')) { if (z.el.style.opacity !== '0') z.el.style.opacity = '0'; continue }
      if (!z.bw) { z.bw = z.el.offsetWidth || 60; z.bh = z.el.offsetHeight || 14 }
      const bw = z.bw, bh = z.bh!
      let placed = false
      for (let i = 0; i < z.alts.length; i++) {
        this.tmpV.copy(z.alts[i]).project(this.camera)
        if (this.tmpV.z > 1) continue
        const right = i >= 2
        const zx = (this.tmpV.x * 0.5 + 0.5) * w, zy = (-this.tmpV.y * 0.5 + 0.5) * h
        const rect = { x: right ? zx - bw : zx, y: zy - bh, w: bw, h: bh }
        const collides = this.placedRects.some((r) => rect.x < r.x + r.w + 4 && rect.x + rect.w + 4 > r.x && rect.y < r.y + r.h + 2 && rect.y + rect.h + 2 > r.y)
        if (collides && i < z.alts.length - 1) continue
        z.el.style.opacity = collides ? '0.55' : ''
        z.el.style.transform = `translate3d(${Math.round(zx)}px, ${Math.round(zy)}px, 0) translate(${right ? '-100%' : '0'}, -100%)`
        this.placedRects.push(rect)
        placed = true
        break
      }
      if (!placed) z.el.style.opacity = '0'
    }
  }

  resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  reframe(duration = 900) { this.flyTo(this.focus, this.lastCam, duration) }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('resize', this.resize)
    this.labelRoot.innerHTML = ''
    this.renderer.dispose()
  }
}

/** paints a vertex colour gradient from `lo` (bottom) to `hi` (top) — a one-light "sun" for flat materials */
function shadeByHeight(g: THREE.BufferGeometry, lo: number, hi: number) {
  const pos = g.attributes.position as THREE.BufferAttribute
  let minY = Infinity, maxY = -Infinity
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < minY) minY = y; if (y > maxY) maxY = y }
  const a = new THREE.Color(lo), b = new THREE.Color(hi), c = new THREE.Color()
  const cols = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) { const t = maxY > minY ? (pos.getY(i) - minY) / (maxY - minY) : 1; c.copy(a).lerp(b, t); cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3))
}

const ZONE_NAME: Record<string, string> = { workflow: 'workflows', capability: 'capacidades', control: 'controles', deliverable: 'entregables', connection: 'conexiones' }

function shorten(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s
}
