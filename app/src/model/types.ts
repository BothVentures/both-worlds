/**
 * BOTH WORLDS — data model.
 *
 * Hierarchy:  world → territory → project (submundo) → element → evidence
 * Two separate axes are modelled:
 *   - belonging  (parentId)          → where something lives
 *   - relation   (Relation records)  → what uses / feeds / produces / reviews what
 *
 * Every material claim carries `sources` (repo + path [+ lines]) and an
 * `evidence` status. Visual size is editorial (layout.weight), never a metric.
 */

export type RepoId = 'both_os' | 'synergy-toolkit' | 'lc-chaman'

export type EntityType =
  | 'world'
  | 'territory'
  | 'project' // venture / module / layer — a submundo with its own composition
  | 'capability' // skill, agent, module, machine
  | 'workflow' // pipeline, automation, harness, routine
  | 'deliverable' // outputs: pages, reports, dashboards, decks
  | 'connection' // external service integration
  | 'control' // human approval / gate / sign-off

export type EvidenceStatus =
  | 'observed-in-code' // a file/route/script exists in the repo
  | 'observed-in-docs' // documented in the repo's own docs
  | 'claimed-by-doc' // a doc claims it is deployed / live / measured — not re-verified here
  | 'executed' // proven by running it during this build (rare — we did not run business code)
  | 'proposed' // only planned / designed
  | 'unknown'

export type State =
  | 'implemented'
  | 'experimental'
  | 'proposed'
  | 'parked'
  | 'retired'

export interface Source {
  repo: RepoId
  path: string
  lines?: string // "12-16" or "L40"
  note?: string
}

export interface Entity {
  id: string
  name: string
  type: EntityType
  parentId?: string
  /** short sub-kind label shown on the card: "venture", "skill", "GitHub Action", "machine"… */
  kind?: string
  summary: string
  state: State
  evidence: EvidenceStatus
  sources: Source[]
  owner?: string
  /** dates reconstructed from git history / docs (ISO). */
  dates?: { first?: string; last?: string }
  /** editorial layout hints — NOT metrics. */
  layout?: {
    weight?: number // 1..3 footprint multiplier (editorial)
    height?: number // block height multiplier (editorial)
    accent?: string // css color for the territory / project accent
    slot?: number // manual ordering inside the parent
  }
  tags?: string[]
  /** real historical activity (e.g. commits per month from git log) — never live telemetry */
  activity?: { label: string; months: string[]; values: number[]; total: number; source: string }
}

export type RelationType =
  | 'uses'
  | 'feeds'
  | 'produces'
  | 'reviews'
  | 'deploys-to'
  | 'documents'
  | 'mirrors'
  | 'reads'
  | 'writes'
  | 'dispatches'
  | 'gates'

export type Verification = 'verified-in-code' | 'verified-in-docs' | 'inferred'

export interface Relation {
  id: string
  from: string
  to: string
  type: RelationType
  label?: string
  evidence: Source[]
  verification: Verification
}

export interface TourStep {
  id: string
  kicker: string // small label above the title
  title: string
  body: string // 1–3 sentences, read from distance
  /** what the camera frames */
  focus: { level: 'world' | 'territory' | 'project' | 'element'; id: string }
  /** optional camera override (deg / factor) */
  camera?: { azimuth?: number; elevation?: number; distance?: number }
  /** entities to emphasise while this step is shown */
  highlight?: string[]
  /** relations to draw while this step is shown */
  relations?: string[]
  /** marks the "future" scene — rendered with the proposed style + banner */
  future?: boolean
  /** spoken narration (also shown as transcript); audio file name under src/audio */
  narration?: string
  audio?: string
  /** people strip (the human element): name, role, the gates they hold, entity ids to highlight on click */
  people?: { name: string; role: string; gate: string; ids: string[] }[]
  /** show the computed coverage numbers strip (entities · relations · sources) */
  stats?: boolean
}

export interface WorldData {
  meta: {
    title: string
    subtitle: string
    generated: string
    coverage: string // plain-language statement of what is and is not covered
    limitations: string[]
  }
  entities: Entity[]
  relations: Relation[]
  tour: TourStep[]
}

export const STATE_LABEL: Record<State, string> = {
  implemented: 'Implementado',
  experimental: 'Experimental',
  proposed: 'Propuesto',
  parked: 'En pausa',
  retired: 'Retirado',
}

export const EVIDENCE_LABEL: Record<EvidenceStatus, string> = {
  'observed-in-code': 'Observado en código',
  'observed-in-docs': 'Observado en documentación',
  'claimed-by-doc': 'Declarado por un documento (no re-verificado)',
  executed: 'Probado por ejecución',
  proposed: 'Propuesto',
  unknown: 'Desconocido',
}

export const VERIFICATION_LABEL: Record<Verification, string> = {
  'verified-in-code': 'verificada en código',
  'verified-in-docs': 'verificada en documentación',
  inferred: 'inferida',
}

export const REPO_LABEL: Record<RepoId, string> = {
  both_os: 'both_os',
  'synergy-toolkit': 'synergy-toolkit',
  'lc-chaman': 'lc-chaman',
}
