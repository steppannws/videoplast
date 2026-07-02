# Videoplaster

[English](./README.md) · **Español**

Instalación interactiva de videomapping: el contenido se deforma sobre una superficie física y reacciona al tacto, detectado con una webcam sensible a IR. Los toques además salen como TUIO hacia otro software.

![Videoplaster — calibración con grid warp y patrón de test](assets/screenshot.png)

## Descripción

Videoplaster proyecta video/imágenes/efectos GPU sobre un relieve físico y convierte esa superficie en una pantalla táctil:

1. **Calibrás la proyección** con un warp de dos capas: ajuste de perspectiva por 4 esquinas más una malla de detalle estilo Photoshop que se subdivide exactamente donde la superficie lo necesita.
2. **Detectás toques** con una webcam a la que se le quitó el filtro IR-cut, mirando la superficie bajo iluminación IR — las yemas de los dedos aparecen como blobs brillantes.
3. **Reacciona**: los toques alimentan el efecto GPU activo (agua, tinta, térmico, …) y se emiten como TUIO 1.1 (UDP :3333) para TouchDesigner, Resolume o lo que sea.

## Hardware

- Un proyector.
- Una **webcam con el filtro IR-cut removido manualmente** (sumale un filtro IR-pass para bloquear la luz visible del proyector), apuntando a la superficie.
- Iluminación IR (p. ej. foco de 850 nm) para que los dedos reflejen con brillo.
- Probado en macOS; la app web en sí es multiplataforma.

Sin hardware de tracking propietario — las únicas entradas son una webcam modificada o el mouse.

## Inicio rápido

```bash
npm install
npm run dev        # → http://localhost:8000  (la fuente MOUSE funciona sin hardware)
```

Opcional — salida TUIO (bridge Python):

```bash
./setup.sh         # una vez: .venv con websockets + python-osc
./run.sh           # bridge TUIO + Vite juntos
```

## Guía de calibración

Presioná `H` para ocultar el panel mientras arrastrás sobre el canvas.

1. **CORNERS** (modo por defecto): arrastrá las 4 esquinas hasta que el cuadrilátero proyectado calce en tu superficie — el ajuste de perspectiva. Arrastrá dentro del cuadrilátero para mover todo; `ZOOM IN/OUT` lo escala.
2. **MESH** (`Tab` o el botón MESH): arrastrá puntos de la malla para curvar la imagen sobre el relieve. **Doble click en cualquier línea de la malla la parte justo ahí** — agregá columnas/filas solo donde necesitás detalle (el espaciado puede ser no uniforme). `−COL` / `−ROW` quitan la línea del punto seleccionado. Mover una esquina después no rompe el detalle de la malla — la malla viaja sobre la capa de perspectiva.
3. **TEST PATTERN**: proyecta un damero a través del warp para ver exactamente cómo va a caer el contenido. Calibrá hasta que el patrón abrace la superficie.
4. **IR DETECT**: elegí la fuente CAMERA y ajustá THRESHOLD / MIN–MAX AREA / BLUR / EROSION mirando las dos previsualizaciones (cuadro procesado + máscara binaria). Arrastrá las esquinas del ROI en la preview para limitar la detección a la superficie. CAPTURE BG resta el fondo estático.
5. **TOUCH MAP**: afiná OFF X/Y y SCALE X/Y para alinear los toques con el contenido proyectado.
6. **SHOW TOUCHES**: dibuja una cruz en la posición warpeada de cada toque — verificación de punta a punta. (Destildá WARP GRID cuando pruebes con el mouse, así los clicks pasan como toques.)
7. `Ctrl+Z` / `Ctrl+Shift+Z` deshacen/rehacen ediciones del warp. `RESET WARP` resetea solo la capa activa.

Todo persiste en `localStorage` (`vp_settings`).

## Fuentes

| Fuente | Qué es |
|---|---|
| MOUSE | Mouse/trackpad como toque falso — desarrollá sin hardware. |
| CAMERA | Webcam getUserMedia → pipeline de detección de blobs IR → toques. |

## Efectos

Las teclas `1`–`6` cambian el efecto; cada uno expone sus propios sliders.

WATER · INK BLOOM · EROSION REVEAL · THERMAL HEAT · SHATTER GLASS · PARTICLE CHAOS

## Teclas

| Tecla | Acción |
|---|---|
| `H` | ocultar/mostrar el panel |
| `F` | pantalla completa |
| `Esc` | mostrar el panel |
| `Tab` | modo CORNERS ↔ MESH |
| doble click en una línea de la malla | insertar columna/fila ahí |
| `Ctrl+Z` / `Ctrl+Shift+Z` | deshacer / rehacer ediciones del warp |
| flechas (`Shift` = ×10) | mover el handle seleccionado |
| `1`–`6` | cambiar efecto |

## Salida TUIO

Cada toque (de cualquier fuente) se envía por WebSocket a `ws://localhost:7681`; el bridge Python (`bridge/tuio-bridge.py`) lo reenvía como TUIO 1.1 `/tuio/2Dcur` por UDP `127.0.0.1:3333`. El bridge es opcional — sin él la app funciona igual, solo perdés TUIO.

## App macOS standalone (Tauri)

```bash
./scripts/build-bridge.sh   # congela el bridge TUIO como binario sidecar
npm run tauri:build         # o tauri:dev
```

El shell de Tauri abre una ventana kiosco y gestiona el sidecar automáticamente. El permiso de cámara está declarado en `Info.plist` / entitlements.

## Desarrollo

```bash
npm test            # typecheck + tests unitarios (node --test)
npm run typecheck
```

Ver [DEVELOPMENT.md](DEVELOPMENT.md) para detalles de arquitectura.

## Solución de problemas

- **La lista de cámaras está vacía** — dale permiso de cámara (macOS: Ajustes → Privacidad y seguridad → Cámara) y volvé a elegir CAMERA.
- **No se detectan toques** — mirá la preview de máscara: las yemas deben verse como blobs blancos. Más luz IR, THRESHOLD más bajo, o ajustá el ROI. Probá CAPTURE BG con la superficie vacía.
- **Toques desalineados** — verificá con SHOW TOUCHES; corregí con TOUCH MAP.
- **No llega TUIO** — ¿está corriendo el bridge (`./run.sh` o el sidecar de Tauri)? Al arrancar imprime `WS :7681  TUIO -> 127.0.0.1:3333`.

## Tecnología

Vite + TypeScript vanilla · WebGL1 (warp + efectos) · Canvas 2D (overlays) · getUserMedia · Python 3 (websockets + python-osc) para el relay TUIO · Tauri v2 para el build de escritorio.
