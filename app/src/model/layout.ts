import type { Entity, WorldData } from './types'

/**
 * Deterministic spatial layout. No simulation: positions are pure functions
 * of the ordered data, so the composition is identical on every reload.
 *
 * Units: 1 = "one city block". Territories are floating platforms; projects
 * are pads on a platform; elements are blocks on a pad.
 */

export interface Placed {
  id: string
  entity: Entity
  x: number
  z: number
  y: number // base height of the surface it stands on
  w: number // footprint width (x)
  d: number // footprint depth (z)
  h: number // block height (elements) / platform thickness (territories)
  level: 1 | 2 | 3
  children: Placed[]
  /** pads only: type zones (subsections) in world coords */
  zones?: Zone[]
}

export interface Zone { type: string; x: number; z: number; w: number; d: number; n: number }

export interface LayoutResult {
  byId: Map<string, Placed>
  territories: Placed[]
  world: { w: number; d: number }
}

/** Fixed, hand-placed world composition (editorial). Ids must match the data. */
const TERRITORY_SLOTS: Record<string, { x: number; z: number; y: number; azimuth: number }> = {
  't-both-ventures': { x: -4, z: 2, y: 4.4, azimuth: 0.35 },
  't-synergy-toolkit': { x: 40, z: -22, y: 5.6, azimuth: -0.4 },
  't-lc-chaman': { x: 34, z: 22, y: 3.6, azimuth: 0.9 },
}

export function territoryAzimuth(id: string): number {
  return TERRITORY_SLOTS[id]?.azimuth ?? 0.4
}

const ELEMENT_ORDER: Record<string, number> = {
  control: 0,
  workflow: 1,
  capability: 2,
  connection: 3,
  deliverable: 4,
}

function sortChildren(a: Entity, b: Entity) {
  const sa = a.layout?.slot ?? 999, sb = b.layout?.slot ?? 999
  if (sa !== sb) return sa - sb
  const ta = ELEMENT_ORDER[a.type] ?? 9, tb = ELEMENT_ORDER[b.type] ?? 9
  if (ta !== tb) return ta - tb
  return a.name.localeCompare(b.name)
}

/** Grid that is wider than deep — reads as a district from a 3/4 camera. */
function gridDims(n: number, aspect = 1.6) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * aspect)))
  const rows = Math.max(1, Math.ceil(n / cols))
  return { cols, rows }
}

export function computeLayout(data: WorldData): LayoutResult {
  const byId = new Map<string, Placed>()
  const childrenOf = new Map<string, Entity[]>()
  for (const e of data.entities) {
    if (!e.parentId) continue
    const arr = childrenOf.get(e.parentId) ?? []
    arr.push(e)
    childrenOf.set(e.parentId, arr)
  }
  for (const arr of childrenOf.values()) arr.sort(sortChildren)

  const territories: Placed[] = []
  const tEntities = data.entities.filter((e) => e.type === 'territory')

  for (const t of tEntities) {
    const slot = TERRITORY_SLOTS[t.id] ?? { x: 0, z: 0, y: 2, azimuth: 0 }
    const projects = childrenOf.get(t.id) ?? []

    // 1) lay out each project's elements → pad size.
    //    Elements are grouped by type into ZONES (Civ VI districts): each zone is a small grid,
    //    zones are shelf-packed inside the pad, so a pad reads as "its subsections" at a glance.
    const pads: Placed[] = []
    const cell = 1.15 // block pitch
    for (const p of projects) {
      const els = childrenOf.get(p.id) ?? []
      const groups = new Map<string, Entity[]>()
      for (const el of els) { const g = groups.get(el.type) ?? []; g.push(el); groups.set(el.type, g) }
      const order = [...groups.entries()].sort((a, b) => (ELEMENT_ORDER[a[0]] ?? 9) - (ELEMENT_ORDER[b[0]] ?? 9))
      type G = { type: string; els: Entity[]; cols: number; rows: number; w: number; d: number; x: number; z: number }
      const gs: G[] = order.map(([type, ge]) => {
        const n = ge.length
        const { cols, rows } = n <= 3 ? { cols: n, rows: 1 } : gridDims(n, 1.5)
        return { type, els: ge, cols, rows, w: cols * cell, d: rows * cell, x: 0, z: 0 }
      })
      const gg = 0.62 // gap between zones
      const area = gs.reduce((a, g) => a + (g.w + gg) * (g.d + gg), 0)
      const targetW = Math.max(Math.sqrt(area * 1.9), Math.max(...gs.map((g) => g.w), 1))
      let cx = 0, cz = 0, rowD = 0, contentW = 0
      const zrows: G[][] = [[]]
      for (const g of gs) {
        if (cx + g.w > targetW + 1e-6 && zrows[zrows.length - 1].length > 0) { cz += rowD + gg; cx = 0; rowD = 0; zrows.push([]) }
        g.x = cx + g.w / 2; g.z = cz + g.d / 2
        cx += g.w + gg; rowD = Math.max(rowD, g.d); contentW = Math.max(contentW, cx - gg)
        zrows[zrows.length - 1].push(g)
      }
      const contentD = cz + rowD
      for (const row of zrows) {
        const rowW = row.reduce((a, g) => a + g.w, 0) + gg * (row.length - 1)
        const shift = (contentW - rowW) / 2
        for (const g of row) g.x += shift
      }
      const inset = 0.95
      const padW = Math.max(contentW + inset * 2, 2.6) * (p.layout?.weight ?? 1)
      const padD = Math.max(contentD + inset * 2, 2.2) * (p.layout?.weight ?? 1)
      const pad: Placed = { id: p.id, entity: p, x: 0, z: 0, y: 0, w: padW, d: padD, h: 0.14, level: 2, children: [], zones: [] }
      const ox = -contentW / 2, oz = -contentD / 2 // content centred on the pad
      for (const g of gs) {
        pad.zones!.push({ type: g.type, x: ox + g.x, z: oz + g.z, w: g.w, d: g.d, n: g.els.length })
        g.els.forEach((el, i) => {
          const c = i % g.cols, r = Math.floor(i / g.cols)
          const gx = ox + g.x + (c - (g.cols - 1) / 2) * cell
          const gz = oz + g.z + (r - (g.rows - 1) / 2) * cell
          const hBase = el.type === 'workflow' ? 0.95 : el.type === 'control' ? 0.55 : el.type === 'deliverable' ? 0.45 : el.type === 'connection' ? 0.35 : 0.7
          const h = el.state === 'proposed' ? 0.04 : hBase * (el.layout?.height ?? 1) * (el.state === 'retired' || el.state === 'parked' ? 0.6 : 1)
          pad.children.push({ id: el.id, entity: el, x: gx, z: gz, y: 0, w: 0.72, d: 0.72, h, level: 3, children: [] })
        })
      }
      pads.push(pad)
    }

    // 2) pack pads into rows on the platform (shelf packing, deterministic)
    const gap = 1.6
    const totalArea = pads.reduce((s, p) => s + (p.w + gap) * (p.d + gap), 0)
    const targetW = Math.max(Math.sqrt(totalArea * 1.7), 8)
    let cx = 0, cz = 0, rowD = 0, platW = 0
    const rows: Placed[][] = [[]]
    for (const pad of pads) {
      if (cx + pad.w > targetW && rows[rows.length - 1].length > 0) {
        cz += rowD + gap
        cx = 0
        rowD = 0
        rows.push([])
      }
      pad.x = cx + pad.w / 2
      pad.z = cz + pad.d / 2
      cx += pad.w + gap
      rowD = Math.max(rowD, pad.d)
      platW = Math.max(platW, cx - gap)
      rows[rows.length - 1].push(pad)
    }
    const platD = cz + rowD
    // center rows horizontally
    for (const row of rows) {
      const rowW = row.reduce((s, p) => s + p.w, 0) + gap * (row.length - 1)
      const shift = (platW - rowW) / 2
      for (const p of row) p.x += shift
    }
    // center the whole platform on its slot
    const margin = 2.4
    const W = platW + margin * 2, D = platD + margin * 2
    for (const pad of pads) {
      pad.x = slot.x + (pad.x - platW / 2)
      pad.z = slot.z + (pad.z - platD / 2)
      pad.y = slot.y + 0.14
      for (const zn of pad.zones ?? []) { zn.x += pad.x; zn.z += pad.z }
      for (const el of pad.children) {
        el.x += pad.x
        el.z += pad.z
        el.y = pad.y + pad.h
      }
    }
    const placedT: Placed = { id: t.id, entity: t, x: slot.x, z: slot.z, y: slot.y, w: W, d: D, h: 1.1, level: 1, children: pads }
    territories.push(placedT)
    byId.set(t.id, placedT)
    for (const pad of pads) {
      byId.set(pad.id, pad)
      for (const el of pad.children) byId.set(el.id, el)
    }
  }
  return { byId, territories, world: { w: 140, d: 140 } }
}

/** Bounding footprint of a placed node including children. */
export function bounds(p: Placed) {
  return { cx: p.x, cz: p.z, w: p.w, d: p.d, y: p.y }
}

/** Bounding footprint of all territories. */
export function worldBounds(territories: Placed[]) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const t of territories) {
    minX = Math.min(minX, t.x - t.w / 2)
    maxX = Math.max(maxX, t.x + t.w / 2)
    minZ = Math.min(minZ, t.z - t.d / 2)
    maxZ = Math.max(maxZ, t.z + t.d / 2)
  }
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ }
}
