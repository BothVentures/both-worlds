# Registro del experimento — versión FABLE5 / Claude Code

## Entorno

| Ítem | Valor |
|---|---|
| Modelo | Claude Fable 5.1 (`claude-fable-5-1`), informado por el harness de Claude Code; no verificable desde el código |
| Harness | Claude Code dentro de la extensión de VS Code, sesión abierta en `/Users/boris/GitHub/both_os` |
| Máquina | macOS (Darwin 25.5.0), Node v22.23.1, npm 10.9.8 |
| Workspace | `/Users/boris/GitHub/both-worlds-fable5` (nuevo; no existía nada con ese nombre) |
| Navegador de verificación | Playwright Chromium headless shell 153 (SwiftShader), porque el Chrome del MCP `chrome-devtools` estaba tomado por otra sesión |
| Puerto | 4173, `strictPort`, sin matar procesos ajenos (5173 y 5188 estaban ocupados por otros Vite) |

## Fuentes utilizadas y faltantes

Ver `research/00-sources-manifest.md`. Resumen: tres repos locales leídos en solo lectura (`both_os` @ `0a0ef5cb`, `synergy-toolkit` @ `8cc6eca`, `lc-chaman` @ `95b83e4`), los tres PRIVATE según `gh repo view`. No accedidos: `both-private`, `content-factory-sandbox`, `COMANDO-AI/C-OS`, base SQLite del Toolkit, transcripts y material sensible. Ninguna carpeta `both-worlds-*` ajena existía ni fue abierta.

## Secuencia real de trabajo

| Hora (local) | Etapa |
|---|---|
| 11:02 | Inspección del entorno, puertos, repos; lectura de las 3 imágenes de referencia del Desktop |
| 11:05 | Workspace creado; scaffold Vite + React + TS; 3 investigadores de inventario + 1 de herramientas 3D lanzados en paralelo |
| 11:12 | Manifiesto de fuentes y dirección visual (tres enfoques comparados) escritos; tipos, validador, cámara, layout |
| 11:20–11:35 | Inventario `both_os` leído; entidades de Both Ventures escritas; investigadores restantes terminan |
| (pausa pedida por Boris hasta que regenerara el límite de sesión) | |
| 12:00 | Inventarios Toolkit y El Chamán leídos; entidades, relaciones y tour escritos; validador OK (563 rutas existentes) |
| 12:10 | Escena three.js + UI React; primera captura real |
| 12:15–12:38 | Cuatro iteraciones con captura: etiquetas (bug de opacidad), niebla, relaciones por nivel, encuadre para la tarjeta del tour y el panel, cupo y anticolisión de etiquetas |
| 12:40 | Suite e2e (56/56 en 1920×1080 y 1440×900), build normal y single-file (949 KB) |
| 12:41–12:50 | Prueba `file://` del HTML autocontenido, launchers, README, reportes, paquete |

Tiempo de pared medido por marcas de archivo: ~1 h 50 min de trabajo efectivo (11:02 → ~12:50), descontando la pausa. El tiempo de la pausa no se midió.

## Decisiones técnicas

| Decisión | Alternativas consideradas | Por qué |
|---|---|---|
| three.js vanilla dentro de un componente React | React Three Fiber + drei; PixiJS isométrico 2D; grafo de fuerzas | Escena determinista de ~240 nodos con cámara guionada: R3F añadía acoplamiento de versiones y otro modelo de render sin beneficio; Pixi perdía cámara real, horizonte y niebla; el grafo de fuerzas rompe la jerarquía y cambia al recargar (`research/03-tools-research.md`) |
| Wireframe por `EdgesGeometry` + `LineBasicMaterial` (1 px) con niebla | `Line2/LineMaterial`, meshline, bloom | Trazo fino y nítido como en la referencia DataV; sin post-procesado pesado; halos como sprites aditivos |
| Etiquetas HTML proyectadas con fuentes del sistema + anticolisión codiciosa y cupo por nivel | troika SDF, CSS2DRenderer | Offline por construcción (troika descarga fuentes en runtime), nítidas a cualquier DPR, estilizables como chips de vidrio |
| Layout determinista: slots fijos por territorio, shelf-packing de pads, grilla de bloques ordenada por `slot`/tipo/nombre | d3 circle packing, simulación de fuerzas | Composición idéntica en cada carga; el tamaño es editorial, no métrica |
| Grilla del suelo en shader (`fract/fwidth`) sobre un plano curvado en CPU + montañas wireframe con PRNG sembrado | `three-globe`, bending de todos los materiales | Horizonte curvo tipo DRONECOM sin tocar cada material; atmósfera distinguible del contenido real (más apagada, sin etiquetas) |
| Relaciones por nivel: mundo/tour → solo explícitas; territorio → entre pads y cruzadas, al 30 %; proyecto → solo explícitas; elemento → las suyas | Mostrar todas siempre | Evitar la "nube" y el anti-patrón de todo-conectado-al-centro que el brief prohíbe |
| Single-file con `vite-plugin-singlefile`, sin `public/`, datos importados como módulos | Servidor obligatorio | Doble clic funciona desde `file://` (probado con la suite e2e completa) |
| Estados como lenguaje visual: pleno / con brecha / solo huella punteada / gris | Colores por estado | Distingue propuesto de implementado sin arcoíris |
| Dependencias añadidas: `three`, `vite-plugin-singlefile`, `playwright` (dev) | `camera-controls`, `simplex-noise`, `d3-hierarchy`, `postprocessing` (recomendadas por el research) | Un director de cámara propio de 90 líneas dio easing cúbico reproducible; el ruido y el layout se resolvieron con un PRNG y funciones simples; el bloom quedó fuera por el brief ("sin post-procesado pesado") |
| Voz de la narración: `edge-tts` es-MX-DaliaNeural (elección del equipo, 2026-09-08) | Voces compactas y Enhanced de macOS; Qwen3-TTS / Chatterbox / MOSS-TTS locales vía `mlx-audio`; ElevenLabs u otro SaaS pago | Seis muestras A/B del mismo párrafo; Dalia ganó al oído. Gratis, sin cuenta, un comando; internet solo al generar (clips embebidos). Qwen local queda documentado como alternativa con clonación de voz si más adelante se quiere narrar con la voz de un miembro del equipo |
| Acento oliva (Olive-Gold Bright `#C5C52A`) en toda la plataforma (2026-09-09) | Mantener violeta; oliva base `#939324`; dos acentos | Pedido explícito del equipo (probar el verde oliva eléctrico con luz). Se usó la variante *dark-ground* que el propio sistema de marca define; tintes de identidad por territorio se conservan; reversible cambiando tokens |
| Zonas por tipo dentro de cada pad, con rótulo | Grilla única ordenada por tipo (V2); color por tipo | Las subsecciones tienen que leerse sin leyenda: placa + rótulo con conteo (patrón distrito de Civ VI); el color queda para el acento y la identidad |
| Atmósfera sin post-procesado: sprites aditivos, shaders de piso, draw-on por `drawRange`, partículas `Points` | UnrealBloom / OutlinePass (research §2) | El brief prohíbe post pesado; el fondo negro hace que los aditivos lean como bloom; todo pausable y apagable con reduced motion |

## Pruebas ejecutadas

Detalle en `TEST-REPORT.md` y `verification/`. Resumen: validador de datos (ids, padres, profundidad, relaciones, enums, rutas en disco); `tsc -b` limpio; suite e2e Playwright de 28 chequeos × 2 viewports contra el dev server; misma suite contra el HTML autocontenido por `file://`; capturas por iteración comparadas contra la dirección de arte.

## Lo que Boris debe comparar (evidencia, no veredicto)

- Impacto del primer vistazo: `verification/final/01-mundo-1920x1080.png`.
- Comprensión de la jerarquía: `02-both-ventures` → `03-proyecto-bv-os` → `04-elemento-evidencia`.
- Profundidad real: 213 elementos con fuente; ficha con rutas y líneas.
- Fidelidad a las fuentes: `research/inventory-*.md` + `app/scripts/validate-data.mjs` (563/563 rutas existen).
- Fluidez: transiciones de 1,7 s con easing cúbico; órbita lenta pausable; reduced motion.
- Facilidad para abrir y presentar: doble clic en `BOTH-WORLDS.html`.
