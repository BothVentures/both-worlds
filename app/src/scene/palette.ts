import * as THREE from 'three'

/**
 * One accent, from the Both Ventures brand system:
 *   Olive-Gold Bright #C5C52A — "dark-ground variant, lifted for legibility on black".
 * ACCENT_HI is the same hue with more light (glows, selection); ACCENT_DIM for inferred / secondary.
 * Territory identity tints (cyan / amber) stay as *identity*, never as UI accent.
 */
export const BG = 0x06070c
export const INK = new THREE.Color(0xdde3f0)
export const ACCENT = new THREE.Color(0xc5c52a)
export const ACCENT_HI = new THREE.Color(0xe6e670)
export const ACCENT_DIM = new THREE.Color(0x6e6e1c)

/** subtle per-type tints — identity of the building, not the accent */
export const TYPE_TINT: Record<string, THREE.Color> = {
  workflow: new THREE.Color(0xe9edf6),
  capability: new THREE.Color(0xcfd9ee),
  control: new THREE.Color(0xf0e4c8),
  deliverable: new THREE.Color(0xdde3f0),
  connection: new THREE.Color(0xbfe3ea),
}

export const STATE_COLOR = {
  proposed: new THREE.Color(0xcfc6a8),
  parked: new THREE.Color(0x8a90a3),
  retired: new THREE.Color(0x6b7083),
}
