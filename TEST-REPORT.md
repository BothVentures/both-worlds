# Reporte de pruebas y limitaciones — BOTH WORLDS (FABLE5)

Fecha: 2026-09-08 · Navegador: Chromium headless shell 153 vía Playwright (renderizado por SwiftShader) · Viewports: 1920×1080 y 1440×900.

## Resumen

| Prueba | Resultado | Evidencia |
|---|---|---|
| Instalación y build (`npm install`, `tsc -b`, `vite build`, `vite build --mode single`) | ✓ sin errores; bundle 938 KB; single-file 949 KB | `app/dist/`, `app/dist-single/index.html`, `BOTH-WORLDS.html` |
| Validación del modelo de datos (`npm run validate:data`) | ✓ 239 entidades, 108 relaciones, 7 pasos de tour, 0 ids rotos, 0 ciclos, 563/563 rutas de fuente existen en los repos locales | salida del validador |
| App abierta en navegador real (dev server 127.0.0.1:4173) | ✓ | `verification/iter1…iter4/` |
| Consola revisada | ✓ 0 errores en las 4 corridas (dev, e2e ×2 viewports, file://) | reportes e2e |
| Navegación mundo → territorio → proyecto → elemento por clic (sin hover) | ✓ | e2e "click territory/project/element" |
| Regreso (Esc ×2) y reset (Home) | ✓ | e2e "Esc goes back…", "Home resets to world" |
| Recorrido guiado con teclado (← →) y botones del pie; 8 escenas (la 05 = el elemento humano); última escena marcada como futuro | ✓ | e2e "tour…" |
| Pausa de movimiento y reduced motion | ✓ (botones + teclas Espacio / M) | e2e "pause toggles", "reduced motion toggles" |
| Pantalla completa | ✓ `requestFullscreen` aceptado en headless ("entered"); en un navegador real depende del gesto del usuario (botón o tecla F) | e2e "fullscreen request" |
| Etiquetas principales sin superposición (niveles 1, 2 y 3 visibles) | ✓ 0 solapamientos medidos por bounding boxes | e2e "…do not overlap" |
| Controles dentro de la pantalla (1920×1080 y 1440×900) | ✓ | e2e "all controls inside viewport", "evidence panel inside viewport" |
| Ficha de evidencia con fuentes y relaciones | ✓ 4 fuentes / 7 relaciones en el elemento de prueba | e2e |
| Navegación desde el panel ("Contiene") | ✓ | e2e "panel list navigates into a project" |
| HTML autocontenido por `file://` (doble clic) | ✓ misma suite, 60/60, con los 8 clips de audio embebidos (10,8 MB con la voz Dalia es-MX) | `verification/file-protocol/report.md` |
| Capturas 1920×1080 y 1440×900 de mundo, Both Ventures, proyecto y evidencia | ✓ | `verification/final/` |
| Referencias del inventario contra las fuentes | ✓ todas las rutas citadas existen (validador) | `app/scripts/validate-data.mjs` |
| Estado propuesto distinguible del implementado | ✓ huella punteada sin volumen + etiqueta itálica violeta + pill punteada; escena 7 con banda "futuro · propuesto, no construido" | `verification/final/06-tour-futuro-1920x1080.png` |

Suite: `app/scripts/e2e.mjs` — 33 chequeos × 2 viewports = 66 (V3.2: + leyenda ocultable por botón y tecla L) (incluye reproducción de la narración desde la tarjeta y corte al cambiar de escena). Reportes: `verification/e2e/report.md` (dev server) y `verification/file-protocol/report.md` (file://).

## V2 visual (misma fecha, tras revisión estética)

Revisión y plan en `research/05-aesthetic-review.md`. Aplicado: base unit escalonada con núcleo bajo cada plataforma, anillo de cota punteado con ticks, corner brackets, calles dobles entre pads, edificios por tipo (torre con pisos y antena para el héroe, bloque escalonado, pórtico para controles, pila de placas para entregables, nodo cilíndrico para conexiones) con variación determinista de altura, líneas guía con punto de anclaje en las etiquetas, arcos con brillo en los extremos + pines verticales + puntos de aterrizaje, dos anillos de montañas y escenario iluminado. Capturas de la iteración: `verification/iter6…iter8`. Suite e2e re-ejecutada en verde tras el cambio (dev y `file://`).

## V2.1 · pasada RON Design (misma fecha)

Tomado de la referencia de RON Design sin cambiar la identidad: vidrio más profundo y redondeado con tarjetas anidadas, pines circulares como marcadores de anclaje, números grandes con datos reales (cobertura del atlas calculada en tiempo de ejecución; commits por mes por repo desde el git log, marcados como histórico y no telemetría), rayado diagonal sobre el distrito enfocado, calles punteadas como rutas, chrome menos azul. Capturas: `verification/iter10`, `verification/final-v2`.

## Narración · cambio de voz (2026-09-08, noche)

El equipo descartó la voz compacta de macOS (Paulina). Se probaron seis muestras del mismo párrafo (`~/Desktop/both-worlds-voces/`): cuatro voces neuronales de Microsoft vía `edge-tts` (es-UY Valentina y Mateo, es-AR Elena y Tomás, es-MX Dalia) y dos locales con Qwen3-TTS 1.7B sobre `mlx-audio` (Vivian, Ryan; ~1× tiempo real en Apple Silicon, dirigibles por instrucción). Elegida: **es-MX-DaliaNeural**. Las ocho pistas se regeneraron con `node scripts/narrate.mjs` (motor `edge` por defecto), duraciones 124 / 124 / 125 / 93 / 129 / 166 / 76 / 83 s, y la suite volvió a correr en verde en dev y en `file://`. Limitación: `edge-tts` usa el servicio de Microsoft Edge de forma no oficial y requiere internet solo al generar; los clips quedan embebidos en el HTML. No se escuchó cada pista completa de punta a punta: se verificó duración y reproducción desde la tarjeta.

## V3 · sesión nocturna 2026-09-09 (acento oliva + identidad + atmósfera)

Cinco iteraciones con capturas (`verification/v3-iter1…5`) y autocrítica entre cada una. Correcciones que salieron de mirar las capturas: borde luminoso de la placa enfocada demasiado ancho (iter1 → estrechado), exceso de oliva en bordes de pads (bajado), etiquetas héroe culled por un umbral de distancia absoluto (ahora relativo al encuadre), rótulos de zona que tapaban etiquetas (ahora ceden y prueban las cuatro esquinas), etiquetas de territorio/proyecto que desaparecían en 1440×900 (ahora prueban posición debajo y desplazada antes de ocultarse), encuadre del mundo capturado a mitad de tween (espera de la captura ampliada). Suite ampliada a 33 chequeos × 2 viewports = **66/66** en dev y por `file://` (nuevo: rótulos de zona visibles en nivel proyecto). Hover y selección verificados con un handle de depuración (`window.__world`) y capturas `09-hover-*`, `10-hover-*`.

**Robustez de la suite (V3.2):** los tiempos fijos tras cada clic daban falsos negativos con la CPU cargada (dos navegadores en paralelo hacían que la cámara no llegara antes de medir); ahora la suite y las capturas esperan a que el tween de cámara termine (`__world.director.busy`) antes de medir.

**No verificado:** rendimiento con GPU real del polvo (520 puntos) y de las rutas animadas; sólo SwiftShader headless. Safari/Firefox siguen sin probarse.

## Comparación con la dirección de arte

Contra las tres referencias (DataV isométrico, DRONECOM, RON Design): fondo casi negro ✓ · trazos de 1 px con niebla ✓ · plataformas flotantes con base (DataV) ✓ · grilla que se curva al horizonte y montañas wireframe de atmósfera (DRONECOM) ✓ · panel de vidrio con tipografía editorial (RON) ✓ · centros de convergencia como halos aditivos ✓ · pocas etiquetas por escala, con anticolisión ✓ · sin telemetría simulada ✓. Iteraciones documentadas en `verification/iter1…iter4` (bug de opacidad de etiquetas, niebla excesiva, saturación de relaciones, encuadres tapados por la tarjeta del tour y por el panel).

## No realizado / limitaciones

- **No se probó en Safari ni en Firefox.** Solo Chromium headless. WebGL2 en Safari desde `file://` debería funcionar en versiones actuales, pero no está verificado aquí.
- **Renderizado por software (SwiftShader) en las pruebas.** El rendimiento con GPU real será mejor; no se midieron FPS. En la Mac de presentación conviene abrir una vez antes de la reunión.
- **Pantalla completa en navegador real** requiere el gesto del usuario (clic en el botón o tecla F); el headless lo aceptó sin gesto, lo que no prueba el caso real.
- **No se ejecutó código de negocio** de ningún repo: los estados "live/measured" son declaraciones de documentos (marcadas `claimed-by-doc`).
- **Cobertura curada:** 239 registros sobre tres repos; los inventarios completos (`research/inventory-*.md`) contienen más filas de las que el mapa representa (por ejemplo, las 53 skills de lc-chaman aparecen agrupadas en 5 bloques).
- **Relaciones inferidas (4)** se dibujan punteadas; no son integraciones confirmadas.
- **Video corto:** no producido (no se pidió como obligatorio; las capturas de respaldo están en `verification/final/`).
- **Chrome DevTools MCP** no se usó porque el perfil estaba tomado por otra sesión; se reemplazó por Playwright.
- El mapa no cambia de composición al recargar (layout determinista); la única animación continua es la órbita lenta en el nivel mundo, pausable y desactivada con reduced motion.
