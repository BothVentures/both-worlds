import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { world } from './data'
import { audioUrl, audioDuration } from './data/audio'
import { EVIDENCE_HINT, EVIDENCE_SHORT, REL_LABEL, STATE_HINT, STATE_LABEL, TYPE_LABEL, TYPE_LABEL_PLURAL, VERIFICATION_LABEL, type Entity, type EntityType, type Relation, type Source, type State } from './model/types'
import { WorldScene, type Focus, type Level } from './scene/world'

type Mode = 'tour' | 'explore'
type Filter = { kind: 'state'; value: State } | { kind: 'type'; value: EntityType } | null

const entities = new Map(world.entities.map((e) => [e.id, e]))
const childrenOf = new Map<string, Entity[]>()
for (const e of world.entities) {
  if (!e.parentId) continue
  const a = childrenOf.get(e.parentId) ?? []
  a.push(e)
  childrenOf.set(e.parentId, a)
}
const chainOf = (id: string): Entity[] => {
  const out: Entity[] = []
  let e = entities.get(id)
  while (e) { out.unshift(e); e = e.parentId ? entities.get(e.parentId) : undefined }
  return out
}
const levelOfEntity = (e: Entity): Level => (e.type === 'world' ? 'world' : e.type === 'territory' ? 'territory' : e.type === 'project' ? 'project' : 'element')
const isElement = (e: Entity) => e.type !== 'world' && e.type !== 'territory' && e.type !== 'project'
const ELEMENT_ORDER: EntityType[] = ['workflow', 'capability', 'control', 'deliverable', 'connection']

// ---- deep links: #/x/<id> (explore) · #/t/<n> (tour step, 1-based)
type Route = { mode: 'tour'; step: number } | { mode: 'explore'; id: string }
function parseHash(h: string): Route | null {
  const m = h.replace(/^#\/?/, '').split('/')
  if (m[0] === 't') { const n = parseInt(m[1] ?? '', 10); if (n >= 1 && n <= world.tour.length) return { mode: 'tour', step: n - 1 } }
  if (m[0] === 'x') { const id = decodeURIComponent(m[1] ?? ''); if (id === 'world' || entities.has(id)) return { mode: 'explore', id } }
  return null
}
const hashFor = (r: Route) => (r.mode === 'tour' ? `#/t/${r.step + 1}` : `#/x/${encodeURIComponent(r.id)}`)
/** the link the page was opened with — read once, so a dev-mode remount (StrictMode) routes to the same place */
const INITIAL_ROUTE = parseHash(location.hash)

// ---- search index (diacritics-insensitive)
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const INDEX = world.entities
  .filter((e) => e.type !== 'world')
  .map((e) => ({ e, n: norm(e.name), k: norm(e.kind ?? ''), s: norm(e.summary), path: chainOf(e.id).filter((c) => c.type !== 'world' && c.id !== e.id).map((c) => c.name).join(' › '), p: norm(chainOf(e.id).map((c) => c.name).join(' ')) }))
function search(q: string) {
  const toks = norm(q).trim().split(/\s+/).filter(Boolean)
  if (!toks.length) return []
  const out: { e: Entity; path: string; score: number }[] = []
  for (const it of INDEX) {
    let score = 0
    for (const t of toks) {
      let s = 0
      if (it.n.startsWith(t)) s = 8
      else if (it.n.includes(t)) s = 5
      else if (it.k.includes(t)) s = 3
      else if (it.p.includes(t)) s = 2
      else if (it.s.includes(t)) s = 1
      if (!s) { score = 0; break }
      score += s
    }
    if (score) out.push({ e: it.e, path: it.path, score: score + (it.e.type === 'project' ? 1 : it.e.type === 'territory' ? 2 : 0) })
  }
  return out.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name)).slice(0, 12)
}

/** GitHub URL for a source, so "ábranla" is one click */
function srcHref(s: Source): string | undefined {
  const r = world.meta.repos?.[s.repo]
  if (!r) return undefined
  const path = s.path.replace(/^\/+/, '')
  const dir = path.endsWith('/') || !/\.[a-z0-9]+$/i.test(path)
  let url = `${r.url}/${dir ? 'tree' : 'blob'}/${r.branch}/${path.replace(/\/$/, '')}`
  if (s.lines && !dir) {
    const m = s.lines.match(/^L?(\d+)(?:\s*[-–]\s*L?(\d+))?/)
    if (m) url += m[2] ? `#L${m[1]}-L${m[2]}` : `#L${m[1]}`
  }
  return url
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<WorldScene | null>(null)
  const [mode, setMode] = useState<Mode>('tour')
  const [step, setStep] = useState(0)
  const [focus, setFocus] = useState<Focus>({ level: 'world', id: 'world' })
  const [paused, setPaused] = useState(false)
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const [help, setHelp] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  // legend card (bottom-left) can be hidden; the choice is remembered per browser
  const [legend, setLegend] = useState(() => { try { return localStorage.getItem('bw-legend') !== 'off' } catch { return true } })
  useEffect(() => { try { localStorage.setItem('bw-legend', legend ? 'on' : 'off') } catch { /* private mode */ } }, [legend])
  // tour card can be folded to a single row so the scene stays visible while listening
  const [tourMin, setTourMin] = useState(() => { try { return localStorage.getItem('bw-tour') === 'min' } catch { return false } })
  useEffect(() => { try { localStorage.setItem('bw-tour', tourMin ? 'min' : 'full') } catch { /* private mode */ } }, [tourMin])
  const [filter, setFilter] = useState<Filter>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [visibleRel, setVisibleRel] = useState<string[]>([])
  const [fs, setFs] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [transcript, setTranscript] = useState(false)
  const [personSel, setPersonSel] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const peekRef = useRef<HTMLDivElement>(null)
  // narrow desktops (≤1500 px) get shorter toolbar labels so the bar never wraps
  const [compact, setCompact] = useState(() => window.matchMedia?.('(max-width: 1500px)').matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 1500px)')
    if (!mq) return
    const h = () => setCompact(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  const modeRef = useRef(mode)
  modeRef.current = mode
  /** the URL is only written after the first route has been applied (never before, or it would overwrite the link) */
  const routedRef = useRef(false)
  const stepRef = useRef(step)
  stepRef.current = step

  const goTo = useCallback((f: Focus, cam?: { azimuth?: number; elevation?: number; distance?: number }, highlight: string[] = [], rels: string[] = []) => {
    const s = sceneRef.current
    if (!s) return
    setFocus(f)
    s.setHighlight(highlight, rels)
    s.setFocus(f, cam)
    setVisibleRel(s.visibleRelationIds)
  }, [])

  const applyStep = useCallback((i: number) => {
    const st = world.tour[i]
    if (!st) return
    setMode('tour')
    setStep(i)
    goTo(st.focus, st.camera, st.highlight ?? [], st.relations ?? [])
  }, [goTo])

  const explore = useCallback((id: string) => {
    const e = entities.get(id)
    setMode('explore')
    if (!e || e.type === 'world') goTo({ level: 'world', id: 'world' })
    else goTo({ level: levelOfEntity(e), id })
  }, [goTo])

  const route = useCallback((r: Route | null) => {
    routedRef.current = true
    if (!r) { applyStep(0); return }
    if (r.mode === 'tour') applyStep(r.step)
    else explore(r.id)
  }, [applyStep, explore])

  // ---- scene lifecycle
  useEffect(() => {
    const canvas = canvasRef.current!, labels = labelRef.current!
    const scene = new WorldScene(canvas, labels, world, {
      onPick: (id, lvl) => {
        if (!id) return
        const e = entities.get(id)
        if (!e) return
        setMode('explore')
        goTo({ level: lvl === 1 ? 'territory' : lvl === 2 ? 'project' : 'element', id })
      },
      onHover: setHover,
    })
    sceneRef.current = scene
    scene.reducedMotion = reduced
    // start where the link points, else at scene 01
    route(INITIAL_ROUTE)
    const onHash = () => { const r = parseHash(location.hash); if (r) route(r) }
    window.addEventListener('hashchange', onHash)
    return () => { window.removeEventListener('hashchange', onHash); scene.dispose(); sceneRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // keep the URL in sync so any view can be shared (replaceState: no history spam)
  useEffect(() => {
    if (!routedRef.current) return
    const h = hashFor(mode === 'tour' ? { mode: 'tour', step } : { mode: 'explore', id: focus.id })
    if (location.hash !== h) history.replaceState(null, '', h)
  }, [mode, step, focus])

  // ---- navigation helpers
  const up = useCallback(() => {
    const cur = focus
    if (cur.level === 'world') return
    const e = entities.get(cur.id)
    const parent = e?.parentId ? entities.get(e.parentId) : undefined
    if (!parent || parent.type === 'world') goTo({ level: 'world', id: 'world' })
    else goTo({ level: levelOfEntity(parent), id: parent.id })
  }, [focus, goTo])

  const toWorld = useCallback(() => { setMode('explore'); goTo({ level: 'world', id: 'world' }) }, [goTo])
  const enterTour = useCallback(() => applyStep(stepRef.current), [applyStep])

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().then(() => setFs(true)).catch(() => {})
    else document.exitFullscreen?.().then(() => setFs(false)).catch(() => {})
  }, [])
  useEffect(() => {
    const h = () => setFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, [])

  useEffect(() => { if (sceneRef.current) sceneRef.current.paused = paused }, [paused])
  useEffect(() => { if (sceneRef.current) sceneRef.current.reducedMotion = reduced; document.body.classList.toggle('motion-off', reduced) }, [reduced])
  useEffect(() => { if (sceneRef.current) sceneRef.current.interactive = mode === 'explore' }, [mode])
  useEffect(() => {
    const s = sceneRef.current
    if (!s) return
    if (!filter) s.setFilter(null)
    else if (filter.kind === 'state') s.setFilter((e) => e.state === filter.value)
    else s.setFilter((e) => e.type === filter.value)
  }, [filter])
  useEffect(() => { setFilter(null) }, [step])
  const panelRef = useRef(false)
  useEffect(() => {
    const s = sceneRef.current
    if (!s) return
    const open = mode === 'explore' && focus.level !== 'world'
    s.panelOpen = open
    if (open !== panelRef.current) { panelRef.current = open; s.reframe(700) }
  }, [mode, focus])

  // ---- hover peek: follows the cursor without re-rendering the app on every move
  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      const el = peekRef.current
      if (!el) return
      const w = window.innerWidth, h = window.innerHeight
      const x = ev.clientX + 18 > w - 260 ? ev.clientX - 18 - 240 : ev.clientX + 18
      const y = ev.clientY + 18 > h - 90 ? ev.clientY - 18 - 60 : ev.clientY + 18
      el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  // ---- narration audio: one element, swapped per step; stops on step/mode change
  const stopAudio = useCallback(() => {
    const a = audioRef.current
    if (a) { a.pause(); a.currentTime = 0 }
    setPlaying(false); setProgress(0)
  }, [])
  useEffect(() => { stopAudio(); setTranscript(false); setPersonSel(null) }, [step, mode, stopAudio])
  const togglePlay = useCallback(() => {
    const st = world.tour[step]
    const url = st?.audio ? audioUrl(st.audio) : undefined
    if (!url) return
    let a = audioRef.current
    if (!a) { a = new Audio(); audioRef.current = a
      a.addEventListener('timeupdate', () => { if (a && a.duration) setProgress(a.currentTime / a.duration) })
      a.addEventListener('ended', () => { setPlaying(false); setProgress(0) })
    }
    if (a.src !== url) { a.src = url; a.load() }
    if (a.paused) { a.play().then(() => setPlaying(true)).catch(() => setPlaying(false)) } else { a.pause(); setPlaying(false) }
  }, [step])
  useEffect(() => () => { audioRef.current?.pause() }, [])

  // ---- keyboard
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); setSearchOpen((o) => !o); return }
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return
      if (/^[1-9]$/.test(ev.key)) { const n = parseInt(ev.key, 10) - 1; if (n < world.tour.length) { ev.preventDefault(); applyStep(n) } return }
      switch (ev.key) {
        case 'ArrowRight': case 'PageDown': ev.preventDefault(); if (modeRef.current === 'tour') applyStep(Math.min(world.tour.length - 1, step + 1)); else enterTour(); break
        case 'ArrowLeft': case 'PageUp': ev.preventDefault(); if (modeRef.current === 'tour') applyStep(Math.max(0, step - 1)); else enterTour(); break
        case 'Escape': case 'Backspace': ev.preventDefault(); if (help) setHelp(false); else if (filter) setFilter(null); else { setMode('explore'); up() } break
        case 'Home': case 'h': ev.preventDefault(); toWorld(); break
        case ' ': ev.preventDefault(); setPaused((p) => !p); break
        case 'f': ev.preventDefault(); toggleFullscreen(); break
        case 'm': ev.preventDefault(); setReduced((r) => !r); break
        case 't': ev.preventDefault(); if (modeRef.current === 'tour') setMode('explore'); else enterTour(); break
        case '?': ev.preventDefault(); setHelp((x) => !x); break
        case 'l': ev.preventDefault(); setLegend((x) => !x); break
        case 'r': ev.preventDefault(); sceneRef.current?.reframe(); break
        case 'p': ev.preventDefault(); if (modeRef.current === 'tour') togglePlay(); break
        case 'c': ev.preventDefault(); if (modeRef.current === 'tour') setTourMin((x) => !x); break
        case '/': case 'k': case 'b': ev.preventDefault(); setSearchOpen(true); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, applyStep, enterTour, up, toWorld, toggleFullscreen, help, togglePlay, filter])

  const focused = entities.get(focus.id)
  const hovered = hover ? entities.get(hover) : undefined
  const crumbs = useMemo(() => chainOf(focus.id), [focus.id])
  const tourStep = world.tour[step]
  const showPanel = mode === 'explore' && focus.level !== 'world'
  const hint = mode !== 'explore' ? '' : focus.level === 'world' ? 'Tocá un territorio para entrar · arrastrá para orbitar · rueda para acercar · / para buscar' : focus.level === 'territory' ? 'Tocá un distrito para entrar · Esc para subir · / para buscar' : focus.level === 'project' ? 'Tocá un bloque para abrir su ficha · Esc para subir' : ''

  return (
    <>
      <div className="stage">
        <canvas ref={canvasRef} aria-label="Mapa tridimensional de BOTH WORLDS" />
        <div className="vignette" />
        <div className="labels" ref={labelRef} />
      </div>
      <div className="chrome">
        <div className="topbar">
          <div>
            <div className="brand">
              <span className="t">BOTH WORLDS</span>
              <span className="s">{world.meta.subtitle} · {world.meta.version ?? ''} · 3 repos leídos el {world.meta.generated}</span>
            </div>
            <nav className="crumbs" aria-label="ubicación">
              <button onClick={toWorld}>Mundo</button>
              {crumbs.filter((c) => c.type !== 'world').map((c, i, arr) => (
                <span key={c.id} style={{ display: 'contents' }}>
                  <span className="sep">›</span>
                  {i === arr.length - 1 ? <span className="cur">{c.name}</span> : <button onClick={() => { setMode('explore'); goTo({ level: levelOfEntity(c), id: c.id }) }}>{c.name}</button>}
                </span>
              ))}
              {focus.level !== 'world' && (<><span className="sep">·</span><button onClick={() => { setMode('explore'); up() }} title="Volver al nivel anterior (Esc)">↑ subir</button></>)}
            </nav>
          </div>
          <div className="tools" role="toolbar" aria-label="controles">
            <div className="seg" role="group" aria-label="modo">
              <button aria-pressed={mode === 'tour'} onClick={enterTour} title="T">Recorrido</button>
              <button aria-pressed={mode === 'explore'} onClick={() => setMode('explore')} title="T">Explorar</button>
            </div>
            <button onClick={() => setSearchOpen(true)} title="Buscar (/ o ⌘K)" className="search-btn" aria-label="buscar"><span aria-hidden>⌕</span> Buscar</button>
            <button aria-pressed={paused} onClick={() => setPaused((p) => !p)} title="Pausar la órbita lenta (Espacio)" aria-label="órbita">{paused ? 'Órbita: pausa' : 'Órbita'}</button>
            <button aria-pressed={reduced} onClick={() => setReduced((r) => !r)} title="Sin animación (M)" aria-label="sin animación">{compact ? 'Sin anim.' : 'Sin animación'}</button>
            <button aria-pressed={fs} onClick={toggleFullscreen} title="Pantalla completa (F)" aria-label="pantalla completa">{compact ? '⛶' : 'Pantalla completa'}</button>
            <button onClick={() => setHelp((h) => !h)} title="Ayuda (?)" aria-label="ayuda">{compact ? '?' : 'Ayuda'}</button>
            <button aria-pressed={legend} onClick={() => setLegend((x) => !x)} title="Leyenda (L)" aria-label="leyenda">Leyenda</button>
          </div>
        </div>

        <div className="middle">
          {showPanel && focused && (
            <EvidencePanel
              entity={focused}
              relations={visibleRel.map((id) => world.relations.find((r) => r.id === id)!).filter(Boolean)}
              onNavigate={(id) => { const e = entities.get(id); if (e) goTo({ level: levelOfEntity(e), id }) }}
              hover={hover}
            />
          )}
        </div>

        <div className="bottom">
          {legend ? <Legend filter={filter} onFilter={setFilter} /> : <div className="legend-off" aria-hidden />}
          {mode === 'tour' && tourStep ? (
            <section className={`tour${tourStep.future ? ' future' : ''}${tourMin ? ' min' : ''}`} aria-live="polite">
              <button className="nav" onClick={() => applyStep(step - 1)} disabled={step === 0} aria-label="anterior">←</button>
              <div className="body" key={tourStep.id}>
                <button className="fold" onClick={() => setTourMin((x) => !x)} title={tourMin ? 'Desplegar la tarjeta (C)' : 'Plegar la tarjeta para ver el mapa (C)'} aria-label={tourMin ? 'desplegar' : 'plegar'}>{tourMin ? '▴' : '▾'}</button>
                <div className="kicker">{tourStep.kicker}{tourStep.future && <span className="future-tag">futuro · propuesto, no construido</span>}</div>
                <h1>{tourStep.title}</h1>
                <p>{tourStep.body}</p>
                {tourStep.stats && <StatStrip />}
                {tourStep.people && (
                  <div className="people" role="list" aria-label="el elemento humano">
                    {tourStep.people.map((pp) => (
                      <button key={pp.name} role="listitem" className={`person${personSel === pp.name ? ' on' : ''}`} title="Tocá para iluminar sus compuertas en el mapa" onClick={() => { const on = personSel === pp.name; setPersonSel(on ? null : pp.name); sceneRef.current?.setHighlight(on ? (tourStep.highlight ?? []) : pp.ids, []) }}>
                        <span className="pn">{pp.name}</span>
                        <span className="pr">{pp.role}</span>
                        <span className="pg">{pp.gate}</span>
                        <span className="pc">{pp.ids.length} compuertas ↗</span>
                      </button>
                    ))}
                  </div>
                )}
                {tourStep.audio && audioUrl(tourStep.audio) && (
                  <div className="player">
                    <button className={`play${playing ? ' on' : ''}`} onClick={togglePlay} aria-pressed={playing} aria-label={playing ? 'pausar narración' : 'escuchar narración'}>
                      <span className="ico" aria-hidden>{playing ? '❚❚' : '▶'}</span>
                      <span>{playing ? 'Pausar' : 'Escuchar más'}</span>
                      <span className="dur">{fmt(playing ? progress * (audioDuration(tourStep.id) ?? 0) : audioDuration(tourStep.id) ?? 0)}</span>
                    </button>
                    <div className="bar" aria-hidden><i style={{ width: `${progress * 100}%` }} /></div>
                    <button className="tx" onClick={() => setTranscript((t) => !t)} aria-pressed={transcript}>{transcript ? 'ocultar texto' : 'leer texto'}</button>
                    {world.meta.narrationDate && <span className="rec" title="La narración se grabó en esa fecha; los datos del mapa son más nuevos">grabada {world.meta.narrationDate}</span>}
                  </div>
                )}
                {transcript && tourStep.narration && <p className="transcript">{tourStep.narration}</p>}
                <div className="progress" role="list" aria-label="escenas">{world.tour.map((s, i) => <button role="listitem" key={s.id} className={i === step ? 'on' : ''} title={`${i + 1} · ${s.title}`} aria-label={`escena ${i + 1}`} onClick={() => applyStep(i)} />)}</div>
                <div className="meta"><span>{step + 1} / {world.tour.length}</span><span>← → o 1–9 para navegar · P escuchar · C plegar · T explorar · / buscar · ? ayuda</span></div>
              </div>
              <button className="nav" onClick={() => applyStep(step + 1)} disabled={step === world.tour.length - 1} aria-label="siguiente">→</button>
            </section>
          ) : (
            <div style={{ flex: 1 }} />
          )}
        </div>
      </div>
      <div className={`hint${hint && !filter ? ' on' : ''}`}>{hint}</div>
      <div ref={peekRef} className={`peek${hovered && hovered.id !== focus.id ? ' on' : ''}`} aria-hidden>
        {hovered && (
          <>
            <span className="pk-name">{hovered.name}</span>
            <span className="pk-meta">{TYPE_LABEL[hovered.type]}{hovered.kind ? ` · ${hovered.kind}` : ''}</span>
            <span className={`pk-state st-${hovered.state}`}>{STATE_LABEL[hovered.state]}{isElement(hovered) ? ` · ${EVIDENCE_SHORT[hovered.evidence].toLowerCase()}` : ''}</span>
          </>
        )}
      </div>
      {filter && (
        <div className="filter-chip" role="status">
          filtro: <b>{filter.kind === 'state' ? STATE_LABEL[filter.value].toLowerCase() : TYPE_LABEL_PLURAL[filter.value]}</b> · {world.entities.filter((e) => isElement(e) && (filter.kind === 'state' ? e.state === filter.value : e.type === filter.value)).length} en el atlas
          <button onClick={() => setFilter(null)} title="Quitar filtro (Esc)">×</button>
        </div>
      )}
      {searchOpen && <Search onClose={() => setSearchOpen(false)} onGo={(id) => { setSearchOpen(false); explore(id) }} />}
      {help && <Help onClose={() => setHelp(false)} />}
    </>
  )
}

const STATS = (() => {
  const ents = world.entities.filter((e) => e.type !== 'world')
  const srcs = ents.reduce((n, e) => n + e.sources.length, 0) + world.relations.reduce((n, r) => n + r.evidence.length, 0)
  return [
    { n: ents.length, l: 'unidades de trabajo', s: 'con fuente en el repo' },
    { n: world.relations.length, l: 'relaciones', s: `${world.relations.filter((r) => r.verification === 'verified-in-code').length} verificadas en código` },
    { n: srcs, l: 'referencias a archivos', s: 'todas existentes en disco' },
  ]
})()

function StatStrip() {
  return (
    <div className="stats" aria-label="cobertura del atlas">
      {STATS.map((x) => (
        <div className="stat" key={x.l}><span className="n">{x.n.toLocaleString('es-AR')}</span><span className="l">{x.l}</span><span className="s">{x.s}</span></div>
      ))}
    </div>
  )
}

function Activity({ a }: { a: NonNullable<Entity['activity']> }) {
  const max = Math.max(...a.values)
  return (
    <div className="activity">
      <div className="ah"><span className="n">{a.total.toLocaleString('es-AR')}</span><span className="u">commits</span><span className="lab">{a.label}</span></div>
      <div className="bars" role="img" aria-label={a.values.join(', ')}>
        {a.values.map((v, i) => (
          <div className="bar" key={i} title={`${a.months[i]}: ${v} commits`}><i style={{ height: `${Math.max(3, (v / max) * 100)}%` }} /><span>{a.months[i]}</span><b>{v}</b></div>
        ))}
      </div>
      <div className="src-note">{a.source} · histórico, no telemetría</div>
    </div>
  )
}

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

const LEGEND_STATES: { v: State; cls: string; label: string }[] = [
  { v: 'implemented', cls: '', label: 'implementado' },
  { v: 'experimental', cls: 'exp', label: 'experimental' },
  { v: 'proposed', cls: 'pro', label: 'propuesto (solo huella)' },
  { v: 'parked', cls: 'park', label: 'en pausa / retirado' },
]
const LEGEND_TYPES: { v: EntityType; svg: string }[] = [
  { v: 'workflow', svg: 'M6 15V5h6v10M6 8h6M6 11h6M9 5V1l3 1-3 1' },
  { v: 'capability', svg: 'M3 15V7h12v8M6 7V3h6v4M7 11h4M6 3l3-2 3 2' },
  { v: 'control', svg: 'M5 15V7h8v8M5 11h8M9 7V5M9 1l2 2-2 2-2-2z' },
  { v: 'deliverable', svg: 'M2 13h12M3 10h12M4 7h12M4 7v2h3V7' },
  { v: 'connection', svg: 'ELLIPSE' },
]

function Legend({ filter, onFilter }: { filter: Filter; onFilter: (f: Filter) => void }) {
  const isOn = (kind: 'state' | 'type', v: string) => !!filter && filter.kind === kind && filter.value === v
  const toggleState = (v: State) => onFilter(isOn('state', v) ? null : { kind: 'state', value: v })
  const toggleType = (v: EntityType) => onFilter(isOn('type', v) ? null : { kind: 'type', value: v })
  return (
    <aside className="legend" aria-label="leyenda: estados, tipos y cobertura (tocá una fila para filtrar)">
      {LEGEND_STATES.map((s) => (
        <button key={s.v} className={`li${isOn('state', s.v) ? ' on' : ''}`} aria-pressed={isOn('state', s.v)} title={`${STATE_HINT[s.v]} Tocá para resaltar solo estos.`} onClick={() => toggleState(s.v)}>
          <i className={`sw ${s.cls}`} /> {s.label}
        </button>
      ))}
      <div className="li"><i className="sw rel" /> relación verificada</div>
      <div className="li"><i className="sw rel inf" /> relación inferida</div>
      <div className="types" aria-label="tipos">
        {LEGEND_TYPES.map((t) => (
          <button key={t.v} className={`li${isOn('type', t.v) ? ' on' : ''}`} aria-pressed={isOn('type', t.v)} title={`Resaltar solo ${TYPE_LABEL_PLURAL[t.v]}`} onClick={() => toggleType(t.v)}>
            <svg viewBox="0 0 18 16">{t.svg === 'ELLIPSE' ? <><ellipse cx="9" cy="6" rx="5" ry="2" /><path d="M4 6v7a5 2 0 0 0 10 0V6M9 4V1" /></> : <path d={t.svg} />}</svg> {t.v === 'control' ? 'control / gate' : TYPE_LABEL[t.v]}
          </button>
        ))}
      </div>
      <div className="cov">Cobertura: 3 repos leídos el {world.meta.generated} · tamaño de bloque = decisión editorial, no métrica · "live" = declarado por un documento, no verificado en red. Tocá un estado o un tipo para resaltarlo.</div>
    </aside>
  )
}

function SourceRow({ s }: { s: Source }) {
  const href = srcHref(s)
  const text = <><span className="repo">{s.repo}</span>/{s.path}{s.lines ? `:${s.lines}` : ''}</>
  return (
    <div className="src">
      {href ? <a href={href} target="_blank" rel="noopener noreferrer" title="Abrir en GitHub (pide acceso al repo si es privado)">{text}<span className="ext" aria-hidden> ↗</span></a> : text}
      {s.note ? <span className="note"> — {s.note}</span> : null}
    </div>
  )
}

function EvidencePanel({ entity, relations, onNavigate, hover }: { entity: Entity; relations: Relation[]; onNavigate: (id: string) => void; hover: string | null }) {
  const kids = childrenOf.get(entity.id) ?? []
  const sortedKids = [...kids].sort((a, b) => (a.layout?.slot ?? 999) - (b.layout?.slot ?? 999) || a.name.localeCompare(b.name))
  const grouped = sortedKids.length > 6 && sortedKids.every(isElement)
  const groups = grouped ? ELEMENT_ORDER.map((t) => ({ t, items: sortedKids.filter((k) => k.type === t) })).filter((g) => g.items.length) : [{ t: null, items: sortedKids }]
  const rels = relations.filter((r) => r.from === entity.id || r.to === entity.id || entity.type !== 'capability')
  const mine = relations.filter((r) => r.from === entity.id || r.to === entity.id)
  const shown = mine.length ? mine : rels.slice(0, 24)
  const [copied, setCopied] = useState(false)
  const copy = () => { navigator.clipboard?.writeText(location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600) }).catch(() => {}) }
  const KidRow = ({ k }: { k: Entity }) => (
    <button className={`st-${k.state}${hover === k.id ? ' hov' : ''}`} onClick={() => onNavigate(k.id)} title={k.summary}>
      <i className="dot" /><span>{k.name}</span><span className="ty">{k.type === 'project' ? k.kind?.split('·')[0]?.trim() : TYPE_LABEL[k.type]}</span>
    </button>
  )
  return (
    <section className="panel" aria-label="ficha de evidencia">
      <div className="ph">
        <div className="kicker">
          <span className={`pill st-${entity.state}`} title={STATE_HINT[entity.state]}>{STATE_LABEL[entity.state]}</span>
          <span className="pill ev" title={EVIDENCE_HINT[entity.evidence]}>{EVIDENCE_SHORT[entity.evidence]}</span>
          <button className="copy" onClick={copy} title="Copiar el link a esta ficha">{copied ? 'link copiado ✓' : 'copiar link'}</button>
        </div>
        <h2>{entity.name}</h2>
        <div className="kind">{TYPE_LABEL[entity.type]}{entity.kind ? ` · ${entity.kind}` : ''}</div>
      </div>
      <div className="pb">
        <p>{entity.summary}</p>
        {entity.owner && <div className="row"><span className="k">Dueño</span><span>{entity.owner}</span></div>}
        {entity.dates && (entity.dates.first || entity.dates.last) && (
          <div className="row"><span className="k" title="Reconstruidas del historial de git o de la documentación">Fechas</span><span>{[entity.dates.first, entity.dates.last].filter(Boolean).join(' → ')}<span className="muted"> · git/docs</span></span></div>
        )}
        {entity.activity && <Activity a={entity.activity} />}
        <h3>Fuentes ({entity.sources.length})</h3>
        {entity.sources.map((s, i) => <SourceRow s={s} key={i} />)}
        {sortedKids.length > 0 && (
          <>
            <h3>Contiene ({sortedKids.length})</h3>
            {groups.map((g) => (
              <div className="list" key={g.t ?? 'all'}>
                {g.t && <div className="lh">{TYPE_LABEL_PLURAL[g.t]} · {g.items.length}</div>}
                {g.items.map((k) => <KidRow k={k} key={k.id} />)}
              </div>
            ))}
          </>
        )}
        {shown.length > 0 && (
          <>
            <h3>Relaciones visibles ({shown.length})</h3>
            {shown.map((r) => {
              const other = r.from === entity.id ? r.to : r.from
              const o = entities.get(other)
              const f = entities.get(r.from), t = entities.get(r.to)
              const touches = r.from === entity.id || r.to === entity.id
              return (
                <div className={`rel ${r.verification}`} key={r.id} title={`${r.type}${r.label ? ' · ' + r.label : ''}`}>
                  <span className="rt">{REL_LABEL[r.type]}{r.label ? ` · ${r.label}` : ''}</span>
                  <span className="rl">
                    {touches ? (
                      <>{r.from === entity.id ? '→ ' : '← '}<button onClick={() => o && onNavigate(o.id)}>{o?.name ?? other}</button></>
                    ) : (
                      <><button onClick={() => f && onNavigate(f.id)}>{f?.name}</button> → <button onClick={() => t && onNavigate(t.id)}>{t?.name}</button></>
                    )}
                  </span>
                  <span className="rv">{VERIFICATION_LABEL[r.verification]} · {r.evidence.map((e, i) => { const h = srcHref(e); const txt = `${e.repo}/${e.path}${e.lines ? ':' + e.lines : ''}`; return <span key={i}>{i ? ' · ' : ''}{h ? <a href={h} target="_blank" rel="noopener noreferrer">{txt}</a> : txt}</span> })}</span>
                </div>
              )
            })}
          </>
        )}
      </div>
    </section>
  )
}

function Search({ onClose, onGo }: { onClose: () => void; onGo: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const results = useMemo(() => search(q), [q])
  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setSel(0) }, [q])
  const onKey = (ev: React.KeyboardEvent) => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); onClose() }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)) }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); setSel((s) => Math.max(0, s - 1)) }
    else if (ev.key === 'Enter') { ev.preventDefault(); const r = results[sel]; if (r) onGo(r.e.id) }
  }
  return (
    <div className="search-bg" onMouseDown={onClose} role="presentation">
      <div className="search" role="dialog" aria-label="buscar en el atlas" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sin">
          <span aria-hidden>⌕</span>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Buscar una pieza: miner, René, Asana, compuerta, Photonic…" aria-label="buscar" spellCheck={false} />
          <kbd>esc</kbd>
        </div>
        {q.trim() && (
          <ul className="sres" role="listbox">
            {results.length === 0 && <li className="none">Nada con ese nombre. Probá por tipo (workflow, conexión), por dueño o por repo.</li>}
            {results.map((r, i) => (
              <li key={r.e.id} role="option" aria-selected={i === sel} className={i === sel ? 'on' : ''} onMouseEnter={() => setSel(i)} onClick={() => onGo(r.e.id)}>
                <span className={`dot st-${r.e.state}`} />
                <span className="sn">{r.e.name}</span>
                <span className="sk">{TYPE_LABEL[r.e.type]}{r.e.kind ? ` · ${r.e.kind}` : ''}</span>
                <span className="sp">{r.path || 'mundo'}</span>
              </li>
            ))}
          </ul>
        )}
        {!q.trim() && <div className="shint">{INDEX.length} piezas indexadas: nombre, tipo, ruta y resumen · ↑↓ para moverse · Enter para ir</div>}
      </div>
    </div>
  )
}

function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="help" role="dialog" aria-label="ayuda">
      <button className="close btn" onClick={onClose}>cerrar</button>
      <h2>Cómo moverse</h2>
      <table>
        <tbody>
          <tr><td>← → · 1–9</td><td>Recorrido guiado: paso anterior / siguiente, o saltar a una escena (también los botones y las marcas del pie)</td></tr>
          <tr><td>/ · ⌘K</td><td>Buscar cualquier pieza por nombre, tipo, dueño o ruta y saltar a ella</td></tr>
          <tr><td>clic en etiqueta o bloque</td><td>Entrar a un territorio, proyecto o elemento (no depende de hover)</td></tr>
          <tr><td>Esc / Backspace</td><td>Volver al nivel anterior (o quitar el filtro de la leyenda)</td></tr>
          <tr><td>Home / H</td><td>Volver al mundo</td></tr>
          <tr><td>arrastrar · Shift+arrastrar · rueda</td><td>Orbitar · desplazar · acercar (modo exploración)</td></tr>
          <tr><td>P / «Escuchar más»</td><td>Narración en audio de la escena (texto disponible con «leer texto»)</td></tr>
          <tr><td>C</td><td>Plegar o desplegar la tarjeta del recorrido para ver el mapa entero</td></tr>
          <tr><td>leyenda</td><td>Tocá un estado o un tipo para resaltar solo esas piezas; de nuevo para quitarlo</td></tr>
          <tr><td>ficha</td><td>Cada fuente abre en GitHub; «copiar link» comparte la vista exacta (la URL cambia sola al navegar)</td></tr>
          <tr><td>R · Espacio · M · F</td><td>Re-encuadrar · pausar la órbita · sin animación · pantalla completa</td></tr>
          <tr><td>T · L · ?</td><td>Recorrido ⇄ exploración · leyenda · esta ayuda</td></tr>
        </tbody>
      </table>
      <h2 style={{ marginTop: 16, fontSize: 17 }}>Qué significan las etiquetas</h2>
      <dl className="gloss">
        {(Object.keys(STATE_LABEL) as State[]).map((k) => <div key={k}><dt><span className={`pill st-${k}`}>{STATE_LABEL[k]}</span></dt><dd>{STATE_HINT[k]}</dd></div>)}
        {(['observed-in-code', 'observed-in-docs', 'claimed-by-doc'] as const).map((k) => <div key={k}><dt><span className="pill ev">{EVIDENCE_SHORT[k]}</span></dt><dd>{EVIDENCE_HINT[k]}</dd></div>)}
      </dl>
      <p style={{ marginTop: 12, fontSize: 12.5 }}>{world.meta.coverage}</p>
      <ul style={{ fontSize: 12, paddingLeft: 18, margin: 0 }}>{world.meta.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </div>
  )
}
