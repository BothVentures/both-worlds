import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { world } from './data'
import { audioUrl, audioDuration } from './data/audio'
import { EVIDENCE_LABEL, STATE_LABEL, VERIFICATION_LABEL, type Entity, type Relation } from './model/types'
import { WorldScene, type Focus, type Level } from './scene/world'

type Mode = 'tour' | 'explore'

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
  // legend card (bottom-left) can be hidden; the choice is remembered per browser
  const [legend, setLegend] = useState(() => { try { return localStorage.getItem('bw-legend') !== 'off' } catch { return true } })
  useEffect(() => { try { localStorage.setItem('bw-legend', legend ? 'on' : 'off') } catch { /* private mode */ } }, [legend])
  const [hover, setHover] = useState<string | null>(null)
  const [visibleRel, setVisibleRel] = useState<string[]>([])
  const [fs, setFs] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [transcript, setTranscript] = useState(false)
  const [personSel, setPersonSel] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const modeRef = useRef(mode)
  modeRef.current = mode

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
    // start: apply tour step 0
    applyStep(0)
    return () => { scene.dispose(); sceneRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    setStep(i)
    goTo(st.focus, st.camera, st.highlight ?? [], st.relations ?? [])
  }, [goTo])

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
  const panelRef = useRef(false)
  useEffect(() => {
    const s = sceneRef.current
    if (!s) return
    const open = mode === 'explore' && focus.level !== 'world'
    s.panelOpen = open
    if (open !== panelRef.current) { panelRef.current = open; s.reframe(700) }
  }, [mode, focus])

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
      if ((ev.target as HTMLElement)?.tagName === 'INPUT') return
      switch (ev.key) {
        case 'ArrowRight': case 'PageDown': ev.preventDefault(); if (modeRef.current === 'tour') applyStep(Math.min(world.tour.length - 1, step + 1)); else setMode('tour'); break
        case 'ArrowLeft': case 'PageUp': ev.preventDefault(); if (modeRef.current === 'tour') applyStep(Math.max(0, step - 1)); else setMode('tour'); break
        case 'Escape': case 'Backspace': ev.preventDefault(); if (help) setHelp(false); else { setMode('explore'); up() } break
        case 'Home': case 'h': ev.preventDefault(); toWorld(); break
        case ' ': ev.preventDefault(); setPaused((p) => !p); break
        case 'f': ev.preventDefault(); toggleFullscreen(); break
        case 'm': ev.preventDefault(); setReduced((r) => !r); break
        case 't': ev.preventDefault(); setMode((m) => (m === 'tour' ? 'explore' : 'tour')); break
        case '?': ev.preventDefault(); setHelp((x) => !x); break
        case 'l': ev.preventDefault(); setLegend((x) => !x); break
        case 'r': ev.preventDefault(); sceneRef.current?.reframe(); break
        case 'p': ev.preventDefault(); if (modeRef.current === 'tour') togglePlay(); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, applyStep, up, toWorld, toggleFullscreen, help, togglePlay])

  const focused = entities.get(focus.id)
  const crumbs = useMemo(() => chainOf(focus.id), [focus.id])
  const tourStep = world.tour[step]
  const showPanel = mode === 'explore' && focus.level !== 'world'

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
              <span className="s">{world.meta.subtitle} · atlas de 3 repos · {world.meta.generated}</span>
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
            <button aria-pressed={mode === 'tour'} onClick={() => setMode((m) => (m === 'tour' ? 'explore' : 'tour'))} title="T">{mode === 'tour' ? 'Recorrido' : 'Exploración'}</button>
            <button aria-pressed={paused} onClick={() => setPaused((p) => !p)} title="Espacio">{paused ? 'Movimiento: pausa' : 'Movimiento: on'}</button>
            <button aria-pressed={reduced} onClick={() => setReduced((r) => !r)} title="M">Reduced motion</button>
            <button aria-pressed={fs} onClick={toggleFullscreen} title="F">Pantalla completa</button>
            <button onClick={() => setHelp((h) => !h)} title="?">Ayuda</button>
            <button aria-pressed={legend} onClick={() => setLegend((x) => !x)} title="L">Leyenda</button>
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
          {legend ? <Legend /> : <div className="legend-off" aria-hidden />}
          {mode === 'tour' && tourStep ? (
            <section className={`tour${tourStep.future ? ' future' : ''}`} aria-live="polite">
              <button className="nav" onClick={() => applyStep(step - 1)} disabled={step === 0} aria-label="anterior">←</button>
              <div className="body" key={tourStep.id}>
                <div className="kicker">{tourStep.kicker}{tourStep.future && <span className="future-tag">futuro · propuesto, no construido</span>}</div>
                <h1>{tourStep.title}</h1>
                <p>{tourStep.body}</p>
                {tourStep.stats && <StatStrip />}
                {tourStep.people && (
                  <div className="people" role="list" aria-label="el elemento humano">
                    {tourStep.people.map((pp) => (
                      <button key={pp.name} role="listitem" className={`person${personSel === pp.name ? ' on' : ''}`} onClick={() => { const on = personSel === pp.name; setPersonSel(on ? null : pp.name); sceneRef.current?.setHighlight(on ? (tourStep.highlight ?? []) : pp.ids, []) }}>
                        <span className="pn">{pp.name}</span>
                        <span className="pr">{pp.role}</span>
                        <span className="pg">{pp.gate}</span>
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
                  </div>
                )}
                {transcript && tourStep.narration && <p className="transcript">{tourStep.narration}</p>}
                <div className="progress" aria-hidden>{world.tour.map((s, i) => <i key={s.id} className={i === step ? 'on' : ''} />)}</div>
                <div className="meta"><span>{step + 1} / {world.tour.length}</span><span>← → para navegar · P escuchar · T explorar · ? ayuda</span></div>
              </div>
              <button className="nav" onClick={() => applyStep(step + 1)} disabled={step === world.tour.length - 1} aria-label="siguiente">→</button>
            </section>
          ) : (
            <div style={{ flex: 1 }} />
          )}
          <div style={{ width: mode === 'tour' ? 0 : 0 }} />
        </div>
      </div>
      <div className={`hint${mode === 'explore' && focus.level === 'world' ? ' on' : ''}`}>Tocá un territorio para entrar · arrastrá para orbitar · rueda para acercar · Esc para subir</div>
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
          <div className="bar" key={i}><i style={{ height: `${Math.max(3, (v / max) * 100)}%` }} /><span>{a.months[i]}</span><b>{v}</b></div>
        ))}
      </div>
      <div className="src-note">{a.source} · histórico, no telemetría</div>
    </div>
  )
}

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

function Legend() {
  return (
    <aside className="legend" aria-label="leyenda de estados">
      <div className="li"><i className="sw" /> implementado</div>
      <div className="li"><i className="sw exp" /> experimental</div>
      <div className="li"><i className="sw pro" /> propuesto (solo huella)</div>
      <div className="li"><i className="sw park" /> en pausa / retirado</div>
      <div className="li"><i className="sw rel" /> relación verificada</div>
      <div className="li"><i className="sw rel inf" /> relación inferida</div>
      <div className="types" aria-label="tipos">
        <span className="li"><svg viewBox="0 0 18 16"><path d="M6 15V5h6v10M6 8h6M6 11h6M9 5V1l3 1-3 1" /></svg> workflow</span>
        <span className="li"><svg viewBox="0 0 18 16"><path d="M3 15V7h12v8M6 7V3h6v4M7 11h4M6 3l3-2 3 2" /></svg> capacidad</span>
        <span className="li"><svg viewBox="0 0 18 16"><path d="M5 15V7h8v8M5 11h8M9 7V5M9 1l2 2-2 2-2-2z" /></svg> control / gate</span>
        <span className="li"><svg viewBox="0 0 18 16"><path d="M2 13h12M3 10h12M4 7h12M4 7v2h3V7" /></svg> entregable</span>
        <span className="li"><svg viewBox="0 0 18 16"><ellipse cx="9" cy="6" rx="5" ry="2" /><path d="M4 6v7a5 2 0 0 0 10 0V6M9 4V1" /></svg> conexión</span>
      </div>
      <div className="cov">Cobertura: 3 repos leídos el 2026-09-08 · tamaño de bloque = decisión editorial, no métrica · "live" = declarado por un documento, no verificado en red.</div>
    </aside>
  )
}

function EvidencePanel({ entity, relations, onNavigate, hover }: { entity: Entity; relations: Relation[]; onNavigate: (id: string) => void; hover: string | null }) {
  const kids = childrenOf.get(entity.id) ?? []
  const sortedKids = [...kids].sort((a, b) => (a.layout?.slot ?? 999) - (b.layout?.slot ?? 999) || a.name.localeCompare(b.name))
  const rels = relations.filter((r) => r.from === entity.id || r.to === entity.id || entity.type !== 'capability')
  const mine = relations.filter((r) => r.from === entity.id || r.to === entity.id)
  const shown = mine.length ? mine : rels.slice(0, 24)
  return (
    <section className="panel" aria-label="ficha de evidencia">
      <div className="ph">
        <div className="kicker">
          <span className={`pill st-${entity.state}`}>{STATE_LABEL[entity.state]}</span>
          <span className="pill ev">{EVIDENCE_LABEL[entity.evidence]}</span>
        </div>
        <h2>{entity.name}</h2>
        {entity.kind && <div className="kind">{entity.kind}</div>}
      </div>
      <div className="pb">
        <p>{entity.summary}</p>
        {entity.owner && <div className="row"><span className="k">Dueño</span><span>{entity.owner}</span></div>}
        {entity.dates && (entity.dates.first || entity.dates.last) && (
          <div className="row"><span className="k">Fechas (git/docs)</span><span>{[entity.dates.first, entity.dates.last].filter(Boolean).join(' → ')}</span></div>
        )}
        {entity.activity && <Activity a={entity.activity} />}
        <h3>Fuentes ({entity.sources.length})</h3>
        {entity.sources.map((s, i) => (
          <div className="src" key={i}><span className="repo">{s.repo}</span>/{s.path}{s.lines ? `:${s.lines}` : ''}{s.note ? <span className="note"> — {s.note}</span> : null}</div>
        ))}
        {sortedKids.length > 0 && (
          <>
            <h3>Contiene ({sortedKids.length})</h3>
            <div className="list">
              {sortedKids.map((k) => (
                <button key={k.id} className={`st-${k.state}${hover === k.id ? ' hov' : ''}`} onClick={() => onNavigate(k.id)}>
                  <i className="dot" /><span>{k.name}</span><span className="ty">{k.type === 'project' ? k.kind?.split('·')[0]?.trim() : k.type}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {shown.length > 0 && (
          <>
            <h3>Relaciones visibles ({shown.length})</h3>
            {shown.map((r) => {
              const other = r.from === entity.id ? r.to : r.from
              const o = entities.get(other)
              const f = entities.get(r.from), t = entities.get(r.to)
              return (
                <div className={`rel ${r.verification}`} key={r.id}>
                  <span className="rt">{r.type}{r.label ? ` · ${r.label}` : ''}</span>
                  <span className="rl">
                    {r.from === entity.id || r.to === entity.id ? (
                      <>{r.from === entity.id ? '→ ' : '← '}<button onClick={() => o && onNavigate(o.id)}>{o?.name ?? other}</button></>
                    ) : (
                      <><button onClick={() => f && onNavigate(f.id)}>{f?.name}</button> → <button onClick={() => t && onNavigate(t.id)}>{t?.name}</button></>
                    )}
                  </span>
                  <span className="rv">{VERIFICATION_LABEL[r.verification]} · {r.evidence.map((e) => `${e.repo}/${e.path}${e.lines ? ':' + e.lines : ''}`).join(' · ')}</span>
                </div>
              )
            })}
          </>
        )}
      </div>
    </section>
  )
}

function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="help" role="dialog" aria-label="ayuda">
      <button className="close btn" onClick={onClose}>cerrar</button>
      <h2>Cómo moverse</h2>
      <table>
        <tbody>
          <tr><td>← →</td><td>Recorrido guiado: paso anterior / siguiente (también los botones del pie)</td></tr>
          <tr><td>clic en etiqueta o bloque</td><td>Entrar a un territorio, proyecto o elemento (no depende de hover)</td></tr>
          <tr><td>Esc / Backspace</td><td>Volver al nivel anterior</td></tr>
          <tr><td>Home / H</td><td>Volver al mundo</td></tr>
          <tr><td>arrastrar · Shift+arrastrar · rueda</td><td>Orbitar · desplazar · acercar (modo exploración)</td></tr>
          <tr><td>P / botón «Escuchar más»</td><td>Narración en audio de la escena del recorrido (texto disponible con «leer texto»)</td></tr>
          <tr><td>R</td><td>Re-encuadrar el nivel actual</td></tr>
          <tr><td>Espacio</td><td>Pausar la órbita lenta</td></tr>
          <tr><td>M</td><td>Reduced motion (sin transiciones)</td></tr>
          <tr><td>F</td><td>Pantalla completa</td></tr>
          <tr><td>T</td><td>Alternar Recorrido / Exploración</td></tr>
          <tr><td>L / botón «Leyenda»</td><td>Mostrar u ocultar la tarjeta de referencias (estados, tipos, cobertura)</td></tr>
        </tbody>
      </table>
      <p style={{ marginTop: 12, fontSize: 12.5 }}>{world.meta.coverage}</p>
      <ul style={{ fontSize: 12, paddingLeft: 18, margin: 0 }}>{world.meta.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </div>
  )
}
