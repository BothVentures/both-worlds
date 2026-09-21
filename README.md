# BOTH WORLDS — atlas cinematográfico y explorable del sistema real de Both Ventures

**Versión FABLE5 / Claude Code · 2026-09-08**
*La infraestructura invisible, hecha visible.*

Un mundo 3D wireframe con tres territorios (uno por repositorio real), proyectos como distritos y unidades de trabajo como bloques. Cada bloque abre una ficha con estado, evidencia y rutas en el repo. Sin backend, sin internet, sin secretos.

## Abrir

**Online (recomendado para el equipo): https://bothventures.github.io/both-worlds/**

Se actualiza solo: cada push a `main` que toque `app/` reconstruye y republica el sitio (GitHub Actions → GitHub Pages, ~2 min). La versión web es multi-archivo: carga ~1 MB y baja cada clip de narración recién cuando se reproduce. Desde ahí también se puede bajar el archivo offline: https://bothventures.github.io/both-worlds/BOTH-WORLDS.html

El sitio es público para quien tenga el link (GitHub Pages no soporta repos privados fuera de Enterprise) y lleva `noindex` + `robots.txt` para que no lo listen los buscadores; los bots de vista previa de Slack y WhatsApp sí pasan, así que el link se comparte con imagen y título.

En teléfono no se abre el atlas: la UI es de tamaño fijo y se corta, así que abajo de 820 px aparece una tarjeta que pide abrirlo en una computadora (con un «abrirlo igual» por las dudas).

### Offline, en esta carpeta

1. **Doble clic en `BOTH-WORLDS.html`** (raíz de esta carpeta). Es un archivo HTML autocontenido (~8 MB, todo inline: código, datos, estilos y los ocho clips de narración; fuentes del sistema). Probado desde `file://` en Chromium: WebGL y navegación funcionan. También `Abrir-BOTH-WORLDS.command` (macOS) hace lo mismo.
2. **Servidor local sencillo:** `Servir-BOTH-WORLDS.command` (macOS) o `node serve.mjs` — sirve `app/dist/` en el primer puerto libre a partir de 4173 y abre el navegador.
3. **Desde código:** `cd app && npm install && npm run dev` → `http://127.0.0.1:4173/` (puerto fijo, `strictPort`).

Viewport principal 1920×1080; verificado también a 1440×900. Pantalla completa con `F`.

## Cómo se usa

| Tecla / gesto | Acción |
|---|---|
| `←` `→` o botones del pie | Recorrido guiado, 8 escenas (la 05 presenta a las cinco personas del equipo como el elemento humano; clic en cada nombre ilumina sus compuertas) |
| clic en etiqueta o bloque | Entrar a territorio → proyecto → elemento (sin depender de hover) |
| `Esc` / `Backspace` | Subir un nivel · `Home`/`H` volver al mundo |
| arrastrar · Shift+arrastrar · rueda | Orbitar · desplazar · acercar (modo exploración) |
| `P` o botón «Escuchar más» | Narración en audio de la escena (entre 1,5 y 3 min por escena); «leer texto» muestra la transcripción |
| `L` o botón «Leyenda» (barra superior) | Muestra u oculta la tarjeta de referencias de abajo a la izquierda (estados, tipos, cobertura). La elección se recuerda en el navegador |
| `Espacio` / `M` / `F` / `T` / `?` | Pausar órbita / reduced motion / pantalla completa / recorrido⇄exploración / ayuda |

La ficha lateral muestra: estado (implementado · experimental · propuesto · en pausa · retirado), tipo de evidencia, resumen, dueño, fechas reconstruidas de git/docs, fuentes (`repo/ruta:líneas`), qué contiene y las relaciones visibles con su verificación (código · docs · inferida).

## Qué hay en la carpeta

```
BOTH-WORLDS.html            ← el entregable de doble clic (build single-file)
Abrir-BOTH-WORLDS.command   ← macOS: abre el HTML
Servir-BOTH-WORLDS.command  ← macOS: servidor local en puerto libre (usa serve.mjs)
serve.mjs                   ← servidor estático mínimo (node), sin dependencias
app/                        ← código fuente (Vite + React + TypeScript + three.js)
  src/data/*.json           ← MODELO DE DATOS EDITABLE (entidades por repo, relaciones, tour, meta)
  src/model/                ← tipos + layout determinista
  src/scene/                ← escena three.js, cámara dirigida, utilidades
  scripts/validate-data.mjs ← valida ids, padres, relaciones, enums y rutas de fuentes en disco
  scripts/e2e.mjs           ← pruebas end-to-end en Chromium headless (Playwright)
  scripts/shot.mjs          ← capturas rápidas con acciones
  scripts/narrate.mjs       ← genera src/audio/*.mp3 desde tour.json (edge-tts es-MX-Dalia por defecto; macOS say como fallback)
  src/audio/                ← 8 clips mp3 (73–97 s c/u, mono 64 kbps) + durations.json
  dist/ · dist-single/      ← builds (normal y single-file), no versionados
.github/workflows/deploy.yml ← build + publicación a GitHub Pages en cada push a main
research/                   ← manifiesto de fuentes, dirección visual, inventarios trazables (local; no va al repo público)
verification/               ← capturas de cada iteración, reporte e2e, prueba file:// (local; no va al repo público)
EXPERIMENT.md               ← registro del experimento (entorno, fuentes, decisiones, pruebas, tiempo)
TEST-REPORT.md              ← qué se probó, qué no, limitaciones
```

## Modelo de datos (editable)

`app/src/data/` — cuatro archivos JSON de entidades/relaciones más el tour:

- **Entidad:** `id`, `name`, `type` (`territory | project | capability | workflow | deliverable | connection | control`), `parentId`, `kind`, `summary`, `state`, `evidence`, `sources[] {repo, path, lines?, note?}`, `owner?`, `dates?`, `layout? {slot, weight, height, accent}` (editorial, no métrica).
- **Relación:** `id`, `from`, `to`, `type` (`uses | feeds | produces | reviews | deploys-to | documents | mirrors | reads | writes | dispatches | gates`), `label?`, `evidence[]`, `verification` (`verified-in-code | verified-in-docs | inferred`).
- **Tour:** `kicker`, `title`, `body`, `focus {level, id}`, `camera?`, `highlight?`, `relations?`, `future?`, `narration` (texto leído), `audio` (archivo en `src/audio/`) y `people?` (tira de personas con nombre, rol, compuertas e ids a iluminar).

**Narración:** el texto de cada escena vive en `tour.json → narration`. `node scripts/narrate.mjs` regenera los ocho mp3 con la voz elegida por el equipo el 2026-09-08: **Dalia (es-MX), voz neuronal de Microsoft vía `edge-tts`** (gratis, sin cuenta; corre con `uvx`, así que solo necesita `uv` instalado e internet en el momento de generar — los clips quedan embebidos y la presentación sigue siendo offline). Fallback sin red: `node scripts/narrate.mjs say Paulina 168` usa la voz de macOS. Otra voz: `node scripts/narrate.mjs edge es-UY-ValentinaNeural` (lista completa con `uvx edge-tts --list-voices`), o reemplazar los mp3 con el mismo nombre y correr `node scripts/narrate.mjs none` para refrescar `durations.json`. Después, `npm run build:single` y copiar `dist-single/index.html` a `BOTH-WORLDS.html`. Alternativa local probada (no adoptada): Qwen3-TTS con `mlx-audio`, dirigible por instrucción y con clonación de voz.

## V3 · sesión nocturna 2026-09-09 (acento oliva + identidad + atmósfera)

- **Un solo acento: Olive-Gold Bright `#C5C52A`**, la variante para fondos oscuros del sistema de marca de Both Ventures (reemplaza al violeta en todo: UI, rutas, selección, gráficos). Tono con luz `#E6E670` para brillos; `#6E6E1C` para inferido. Los tintes de identidad de territorio (cian Toolkit, ámbar Chamán) se mantienen; Both Ventures toma el oliva. Tokens en `app/src/scene/palette.ts` y `:root` de `index.css` — volver al violeta es cambiar esos valores.
- **Subsecciones legibles:** cada pad agrupa sus elementos por tipo en *zonas* (placa punteada + rótulo «workflows · 14»), como los distritos de Civ VI. Layout en `model/layout.ts` (`zones`), dibujo y rótulos en `scene/world.ts`.
- **Identidad por tipo:** plinto en el piso + glifo de techo por tipo (banderín en workflows, marca de cumbrera en capacidades, rombo sobre el pórtico en controles, pestaña en entregables, anillo y antena en conexiones), tinte sutil por tipo, faro aditivo en los héroes, sombreado por altura en los volúmenes.
- **Atmósfera y transiciones:** luz de escenario que sigue al foco, pulso de llegada, rutas que se dibujan al aparecer y llevan paquetes en movimiento, polvo en deriva, brackets de hover, anillo de selección, aparición escalonada de etiquetas y entrada animada de tarjetas. Todo se apaga con *reduced motion*.
- Research que lo sustenta: `research/06-game-map-research.md`. Capturas por iteración: `verification/v3-iter1…5`.


Editar y correr `npm run validate:data` (verifica que cada ruta citada exista en los repos locales). Las posiciones se recalculan de forma determinista; no hay simulación de fuerzas.

Conteo al 2026-09-08 (registros del mapa, **no** "agentes activos"): 239 entidades (3 territorios · 23 proyectos · 213 elementos) · 108 relaciones (43 verificadas en código · 61 en docs · 4 inferidas) · 563 referencias a archivos, todas existentes en disco.

## Cobertura y límites

- Fuentes: `both_os` (HEAD `0a0ef5cb`), `synergy-toolkit` (`8cc6eca`), `lc-chaman` (`95b83e4`), leídos el 2026-09-08. Manifiesto completo: `research/00-sources-manifest.md`.
- "Live" / "deployed" aparece como **declaración de un documento**, no como verificación de red. No se ejecutó código de negocio.
- No representados por falta de acceso: `both-private`, `content-factory-sandbox`, `COMANDO-AI/C-OS`.
- Sin datos comerciales, sin transcripts, sin contactos, sin IDs de cuentas ni tokens.
- Las relaciones inferidas se dibujan punteadas y apagadas; nunca como integraciones reales.

## Dirección visual

V2 (2026-09-08, tras revisar en detalle las referencias DataV y del delta del Ganges): plataformas con base mecánica escalonada, anillo de cota y brackets; distritos con calles; edificios por tipo (torre, bloque escalonado, pórtico, pila de placas, nodo); etiquetas con línea guía; arcos con pines y puntos de aterrizaje. Revisión y plan: `research/05-aesthetic-review.md`. V2.1: pasada inspirada en RON Design (vidrio, pines, números grandes con datos reales, rayado del foco, rutas punteadas).

## Publicación

`main` es la rama viva y publicable. `.github/workflows/deploy.yml` corre en cada push que toque `app/`: `npm ci` → `validate:data` → `build` (con `PUBLIC_BASE=/both-worlds/`, porque un Pages de proyecto se sirve desde un subdirectorio) → `build:single` → sube todo a Pages. Nada más hay que hacer: se commitea y a los dos minutos está arriba.

Para ver localmente lo mismo que se publica: `cd app && npm run build && npm run preview`. El `base` sólo cambia si se define `PUBLIC_BASE`, así que el dev server, el preview y la suite e2e siguen corriendo en la raíz como siempre.

El historial completo del experimento (builds intermedios, 172 capturas de verificación, research) quedó en la rama local `archive/full-history-2026-09-21`, que no se publica: son ~640 MB y los inventarios citan repos privados.

## Stack

Vite 8 · React 19 · TypeScript 6 · three.js r185 (vanilla, sin R3F) · `vite-plugin-singlefile` · Playwright (solo verificación). Tipografía del sistema (serif editorial + monoespaciada). Dirección de arte y alternativas comparadas: `research/02-visual-direction.md`; herramientas evaluadas: `research/03-tools-research.md`.
