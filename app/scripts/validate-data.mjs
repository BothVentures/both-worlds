#!/usr/bin/env node
/**
 * Validates the world data: unique ids, parent chain, relation endpoints,
 * enum values, sources present, tour focus ids, and that hierarchy depth is sane.
 * Exit code 1 on any error. Prints counts (and says what they count).
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(here, '../src/data')

const load = (f) => JSON.parse(readFileSync(resolve(dataDir, f), 'utf8'))

const meta = load('meta.json')
const entityFiles = ['entities.both-os.json', 'entities.synergy-toolkit.json', 'entities.lc-chaman.json']
const entities = entityFiles.flatMap((f) => load(f))
const relations = load('relations.json')
const tour = load('tour.json')

const ENTITY_TYPES = new Set(['world', 'territory', 'project', 'capability', 'workflow', 'deliverable', 'connection', 'control'])
const EVIDENCE = new Set(['observed-in-code', 'observed-in-docs', 'claimed-by-doc', 'executed', 'proposed', 'unknown'])
const STATES = new Set(['implemented', 'experimental', 'proposed', 'parked', 'retired'])
const REL_TYPES = new Set(['uses', 'feeds', 'produces', 'reviews', 'deploys-to', 'documents', 'mirrors', 'reads', 'writes', 'dispatches', 'gates'])
const VERIF = new Set(['verified-in-code', 'verified-in-docs', 'inferred'])
const REPOS = new Set(['both_os', 'synergy-toolkit', 'lc-chaman'])

const errors = []
const warn = []
const ids = new Map()
for (const e of entities) {
  if (!e.id || typeof e.id !== 'string') errors.push(`entity without id: ${JSON.stringify(e).slice(0, 80)}`)
  if (ids.has(e.id)) errors.push(`duplicate id: ${e.id}`)
  ids.set(e.id, e)
  if (!ENTITY_TYPES.has(e.type)) errors.push(`${e.id}: bad type ${e.type}`)
  if (!EVIDENCE.has(e.evidence)) errors.push(`${e.id}: bad evidence ${e.evidence}`)
  if (!STATES.has(e.state)) errors.push(`${e.id}: bad state ${e.state}`)
  if (!e.name) errors.push(`${e.id}: missing name`)
  if (!e.summary) errors.push(`${e.id}: missing summary`)
  if (!Array.isArray(e.sources) || e.sources.length === 0) {
    if (e.type !== 'world') errors.push(`${e.id}: no sources`)
  } else {
    for (const s of e.sources) {
      if (!REPOS.has(s.repo)) errors.push(`${e.id}: bad source repo ${s.repo}`)
      if (!s.path) errors.push(`${e.id}: source without path`)
    }
  }
  if (e.type === 'world' && e.parentId) errors.push(`${e.id}: world cannot have parent`)
  if (e.type !== 'world' && !e.parentId) errors.push(`${e.id}: missing parentId`)
  if (e.state === 'proposed' && e.evidence !== 'proposed' && e.evidence !== 'observed-in-docs') {
    warn.push(`${e.id}: state proposed but evidence ${e.evidence}`)
  }
}
for (const e of entities) {
  if (e.parentId && !ids.has(e.parentId)) errors.push(`${e.id}: parentId ${e.parentId} not found`)
}
// depth + cycles
const depthOf = (e, seen = new Set()) => {
  if (!e.parentId) return 0
  if (seen.has(e.id)) { errors.push(`cycle at ${e.id}`); return 99 }
  seen.add(e.id)
  const p = ids.get(e.parentId)
  return p ? 1 + depthOf(p, seen) : 99
}
const byDepth = {}
for (const e of entities) {
  const d = depthOf(e)
  byDepth[d] = (byDepth[d] || 0) + 1
  if (e.type === 'territory' && d !== 1) errors.push(`${e.id}: territory must be depth 1 (got ${d})`)
  if (e.type === 'project' && d !== 2) errors.push(`${e.id}: project must be depth 2 (got ${d})`)
  if (['capability', 'workflow', 'deliverable', 'connection', 'control'].includes(e.type) && d !== 3) {
    errors.push(`${e.id}: element must be depth 3 (got ${d})`)
  }
}
const relIds = new Set()
for (const r of relations) {
  if (relIds.has(r.id)) errors.push(`duplicate relation id ${r.id}`)
  relIds.add(r.id)
  if (!ids.has(r.from)) errors.push(`relation ${r.id}: from ${r.from} not found`)
  if (!ids.has(r.to)) errors.push(`relation ${r.id}: to ${r.to} not found`)
  if (!REL_TYPES.has(r.type)) errors.push(`relation ${r.id}: bad type ${r.type}`)
  if (!VERIF.has(r.verification)) errors.push(`relation ${r.id}: bad verification ${r.verification}`)
  if (!Array.isArray(r.evidence) || r.evidence.length === 0) errors.push(`relation ${r.id}: no evidence`)
  if (r.from === r.to) errors.push(`relation ${r.id}: self loop`)
}
for (const s of tour) {
  if (!ids.has(s.focus.id)) errors.push(`tour ${s.id}: focus ${s.focus.id} not found`)
  for (const h of s.highlight || []) if (!ids.has(h)) errors.push(`tour ${s.id}: highlight ${h} not found`)
  for (const r of s.relations || []) if (!relIds.has(r)) errors.push(`tour ${s.id}: relation ${r} not found`)
}
// source path existence (best effort — only when the repo is on disk)
const repoRoots = {
  both_os: '/Users/boris/GitHub/both_os',
  'synergy-toolkit': '/Users/boris/Documents/COMANDO/Both_Ventures/synergy-toolkit',
  'lc-chaman': '/Users/boris/Documents/COMANDO/Both_Ventures/lc-chaman',
}
let checked = 0, missing = 0
const missingList = []
const allSources = [...entities.flatMap((e) => e.sources || []), ...relations.flatMap((r) => r.evidence || [])]
for (const s of allSources) {
  const root = repoRoots[s.repo]
  if (!root || !existsSync(root)) continue
  checked++
  const p = resolve(root, s.path.replace(/\/$/, ''))
  if (!existsSync(p)) { missing++; missingList.push(`${s.repo}/${s.path}`) }
}

const countBy = (arr, key) => arr.reduce((m, x) => ((m[x[key]] = (m[x[key]] || 0) + 1), m), {})
console.log('— BOTH WORLDS data validation —')
console.log(`entities: ${entities.length} (records in the map, NOT "active agents")`)
console.log('  by type:', countBy(entities, 'type'))
console.log('  by state:', countBy(entities, 'state'))
console.log('  by evidence:', countBy(entities, 'evidence'))
console.log('  by depth:', byDepth)
console.log(`relations: ${relations.length}`, countBy(relations, 'verification'))
console.log(`tour steps: ${tour.length}`)
console.log(`source refs checked on disk: ${checked}, missing: ${missing}`)
if (missing) console.log('  missing paths:\n   ' + [...new Set(missingList)].join('\n   '))
if (warn.length) console.log('warnings:\n  ' + warn.join('\n  '))
if (errors.length) {
  console.error('ERRORS:\n  ' + errors.join('\n  '))
  process.exit(1)
}
if (!meta.title) { console.error('meta.json without title'); process.exit(1) }
console.log('OK')
