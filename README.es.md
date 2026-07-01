# VIDEOPLASTER 02

[English](./README.md) · 📖 **Español**

Aplicación web de detección táctil y efectos visuales reactivos al tacto. Usa procesamiento de imagen IR, efectos acelerados por GPU, corrección de perspectiva por 4 pines (keystone) y salida TUIO por UDP.

---

## Inicio rápido

```bash
npm install
./setup.sh        # entorno Python (3.12) + bindings LeapC (una sola vez)
npm run dev       # http://localhost:8000/  (la fuente MOUSE funciona sin hardware)
./run.sh          # app completa: bridge Python (IR + TUIO) + servidor Vite
```

- **`npm run dev`** — solo frontend. Usa la fuente `MOUSE` para desarrollar sin hardware.
- **`./run.sh`** — frontend + bridge Python (fotogramas IR por WS :7681, TUIO por UDP :3333).

---

## Requisitos del sistema

### Hardware
- **Leap Motion Controller 2** *(opcional; siempre hay una alternativa `MOUSE`)*
  - Montar de 15 a 30 cm detrás de la superficie de acrílico.
  - Los reflejos IR de los dedos que tocan el acrílico disparan la detección.
  - Compatible con retroproyección (el filtro de paso IR bloquea la luz visible del proyector).

### Software
- **macOS** (Apple Silicon o Intel)
- **Node.js** 18+ y **npm**
- **Python 3.12** — el SDK de Ultraleap incluye un `leapc_cffi` precompilado para 3.12, evitando compilar.
  ```bash
  brew install python@3.12
  ```
- **Ultraleap Tracking Software v6.2.0+** — descargar de https://leap2.ultraleap.com/ (elegir *Leap Motion Controller 2*), instalar y ejecutar el servicio de tracking.

---

## Instalación

```bash
# 1. Instala el Ultraleap Tracking Software (ver enlace arriba) e inicia el servicio.

# 2. Verifica Python 3.12
python3.12 --version            # Python 3.12.x  (brew install python@3.12 si falta)

# 3. Clona y configura
git clone <repo-url>
cd <repo>
npm install                     # dependencias de Node
./setup.sh                      # .venv + bindings LeapC + websockets + python-osc
./check-leap.sh                 # debe imprimir: DEVICE(S) CONNECTED
```

---

## Estructura del proyecto

El frontend es una app de **Vite + TypeScript puro** (sin framework), organizada por funcionalidad. El backend es un pequeño **bridge en Python**; una capa opcional de **Tauri** lo empaqueta como app de escritorio.

```
.                               # raíz del repo
├── index.html                  # entrada: un único <div id="ui"> + carga src/core/app.ts
├── styles/                     # CSS extraído
│   ├── tokens.css              # tokens de diseño (colores, tamaños, fuentes como variables CSS)
│   ├── base.css                # reset, estructura de la página, lienzos
│   └── ui.css                  # estilos del panel de control
├── src/
│   ├── core/                   # arranque + pipeline de render
│   │   ├── app.ts              # arranque de ~110 líneas: monta panel, conecta controladores, inicia el bucle
│   │   ├── render-loop.ts      # pipeline por fotograma (fondo → efecto → warp → overlay)
│   │   └── background.ts       # capa de fondo de imagen/vídeo
│   ├── config/                 # configuración declarativa
│   │   ├── controls.ts         # el panel de control descrito como datos
│   │   └── defaults.ts         # única fuente de verdad para valores de detección/lienzo
│   ├── types/                  # modelo de dominio (domain / effect / settings + barril)
│   ├── ui/                     # capa de interfaz
│   │   ├── control-factory.ts  # constructores de DOM reutilizables (Slider / Checkbox / Section …)
│   │   ├── controls-panel.ts   # construye #ui desde config/controls.ts
│   │   ├── effect-controller.ts + effect-param-panel.ts   # selección de efecto + parámetros
│   │   ├── pin-controller.ts   # overlay de pines de esquina, arrastre + ajuste con flechas
│   │   ├── ir-calibrator.ts    # vista previa IR + calibración de ROI
│   │   ├── overlay.ts          # capa de teclado + rejilla de calibración
│   │   └── persist.ts          # localStorage + enlace tipado de controles
│   ├── gl/                     # primitivas de WebGL
│   │   ├── gl-util.ts          # ayudantes de shader/programa/quad/textura
│   │   ├── base-effect.ts      # andamiaje compartido de efectos (FBO, texturas, setBackground)
│   │   ├── warp-gl.ts          # corrección de perspectiva por 4 pines (keystone)
│   │   └── homography.ts       # mapeo de coordenadas cámara ↔ superficie
│   ├── effects/                # 6 efectos reactivos al tacto + registro
│   │   ├── registry.ts         # lista EFFECTS (el orden = índice de tecla numérica)
│   │   └── water/ink/reveal/thermal/shatter/particles-gl.ts
│   ├── sources/                # fuentes táctiles + registro
│   │   ├── touch-source.ts     # base + MouseTouchSource
│   │   ├── ir-source.ts        # proveedor IR → pipeline
│   │   ├── leap-z-source.ts    # tracking de mano del Leap (umbral Z)
│   │   ├── source-manager.ts + source-registry.ts   # cambio de fuente
│   │   └── output.ts           # TouchEmitter → bridge
│   ├── ir/                     # pipeline de detección IR
│   │   ├── pipeline.ts         # fotograma gris → toques rastreados
│   │   ├── provider.ts / ws-frame-provider.ts / camera-frame-provider.ts
│   │   ├── blobs.ts / tracking.ts / preprocess.ts / undistort.ts
│   └── util/                   # math.ts (clamp, …)
├── bridge/                     # backend Python: WS :7681 (IR) + TUIO UDP :3333
├── src-tauri/                  # capa de escritorio Tauri (ver "App independiente para macOS")
└── vite.config.ts / tsconfig.json / package.json
```

### Flujo de datos

1. **Captura IR** — el bridge Python lee fotogramas IR crudos de LeapC y envía `(ancho, alto, escala de grises)` por WebSocket :7681.
2. **Procesamiento de imagen** (`src/ir/`) — resta de fondo → desenfoque/erosión → detección de blobs → corrección de ojo de pez opcional.
3. **Rastreo** (`ir/tracking.ts`) — emparejamiento temporal por proximidad (`maxDist = 0.08`) que emite eventos `down` / `move` / `up`.
4. **Mapeo** (`gl/homography.ts`, `ir/pipeline.ts`) — píxeles de cámara → UV de superficie normalizada `[0,1]`, con una ROI de captura.
5. **Render y salida** — el efecto activo reacciona a los toques; `gl/warp-gl.ts` aplica la corrección keystone; `sources/output.ts` difunde TUIO por UDP :3333.

---

## Efectos

Seis efectos GPU reactivos al tacto, seleccionables desde el desplegable **EFFECT** o con las **teclas numéricas 1–6**:

| Tecla | Efecto | Descripción |
|-------|--------|-------------|
| 1 | **WATER** | Ondas por ecuación de onda que distorsionan el fondo |
| 2 | **INK BLOOM** | Tinta fluida tipo Navier-Stokes que se arremolina y fluye |
| 3 | **EROSION REVEAL** | El tacto erosiona una capa que cubre y revela el fondo |
| 4 | **THERMAL HEAT** | El calor se difunde y enfría, teñido con una paleta térmica |
| 5 | **SHATTER GLASS** | Fragmentos voronoi procedurales que se agrietan al tocar |
| 6 | **PARTICLE CHAOS** | Partículas GPU empujadas por el tacto y ruido curl |

Cada efecto expone sus propios parámetros ajustables (construidos dinámicamente bajo el desplegable) y los guarda por efecto.

---

## Fuentes y calibración

Elige una fuente en el desplegable **SOURCE**:

- **MOUSE** — desarrollar sin hardware.
- **LEAP IR** — detección de blobs IR a través del Leap (principal; requiere el bridge).
- **PS EYE** — cámara IR de PlayStation Eye vía el bridge *(opcional; ver sección Tauri)*.
- **IR CAMERA** — una webcam IR genérica vía `getUserMedia`.
- **LEAP Z** — tracking de mano del Leap + umbral Z (respaldo).

**Calibración de LEAP IR / IR CAMERA:**
1. **CAPTURE BG** — sin nada tocando la superficie, guarda un fotograma vacío para la resta de fondo.
2. **Calibra la ROI** — arrastra los 4 tiradores de esquina en la vista previa IR para ajustar los límites del acrílico.
3. **Ajusta la detección** — `THRESHOLD` (brillo del blob), `MIN/MAX AREA` (filtro por cantidad de píxeles), `BLUR` / `EROSION` (reducción de ruido), `MIRROR X/Y` (voltear), `FISHEYE` + `K1/K2` (corrección de lente).
4. **Apunta tu cliente TUIO** a `127.0.0.1:3333`.

---

## Comandos

```bash
npm run dev            # servidor de desarrollo con HMR (http://localhost:8000/)
npm run build          # paquete de producción → dist/
npm run preview        # sirve dist/ localmente
npm run typecheck      # verificación estricta de tipos TypeScript
npm test               # tsc + 45 pruebas unitarias (node --test)
./run.sh               # bridge + servidor de desarrollo juntos
./check-leap.sh        # verifica que el dispositivo Leap esté conectado
./spike.sh             # Fase 0: prueba de concepto de IR crudo

.venv/bin/python -m pytest bridge/test_tuio.py -q   # 3 pruebas de codificación TUIO
```

Las **45 pruebas unitarias** cubren la lógica pura: fondo, blobs, homografía, pipeline/preprocesamiento/proveedor IR, fuente IR, Leap-Z, fuente táctil, rastreo, overlay de interfaz, warp y el registro de efectos.

---

## Controles y teclado

### Panel de interfaz
- **FIT SCREEN** — el lienzo llena la ventana (anula el ancho/alto manual).
- **TEST GRID** — superpone la rejilla de calibración + anclas de esquina.
- **RESET ANCHORS** — devuelve los 4 pines a desplazamiento cero.
- **CANVAS** — deslizadores de ancho/alto manuales.
- **SOURCE** — MOUSE / LEAP IR / PS EYE / IR CAMERA / LEAP Z.
- **IMAGE** — cargar una imagen/vídeo de fondo; escalar X/Y; rotar.
- **EFFECT** — elegir 1 de 6 efectos; ajustar sus parámetros.
- **PINS** — desplazamientos X/Y por esquina (corrección keystone).
- **IR DETECT** — umbral, área, desenfoque, erosión, espejo, ojo de pez K1/K2.

### Teclado (modo proyección)
- **H** — ocultar/mostrar el panel de interfaz
- **F** — alternar pantalla completa · **Esc** — salir de pantalla completa + mostrar interfaz
- **1–6** — seleccionar efecto
- **G** — alternar la rejilla de calibración
- **Clic en un pin de esquina**, luego **flechas** para ajustar ±1px (**Shift** = ±10px)

---

## Configuración

### Almacenamiento local
Los valores de control (deslizadores, casillas, ROI, efecto activo) persisten en `localStorage` bajo la clave `vp_settings`.
```javascript
localStorage.getItem('vp_settings')     // ver todos los ajustes como JSON
localStorage.removeItem('vp_settings')  // restablecer a valores por defecto
```

### Salida TUIO
- **Protocolo**: TUIO 1.1 (paquetes OSC binarios) · **Puerto**: UDP 3333
- **Mensajes**: `/tuio/2Dcur` (toques), `/tuio/fseq` (secuencia de fotogramas)
- **Clientes**: TUIO Mouse, Max/MSP, Processing o cualquier receptor OSC

### Notas de montaje
- Montar el Leap a ~15–30 cm detrás del acrílico para que los dedos estén enfocados.
- El filtro de paso IR bloquea la luz visible del proyector → sin contaminación.
- Usar alimentación USB estable (evitar caídas de tensión).

---

## App independiente para macOS (Tauri)

La app puede distribuirse como un `.app` de doble clic que empaqueta el bridge del Leap y ejecuta el frontend WebGL a pantalla completa. El frontend no cambia — sigue comunicándose con el bridge por `ws://localhost:7681`; Tauri solo gestiona la ventana y el ciclo de vida del proceso del bridge.

```bash
npm run tauri:dev        # vite + webview; el backend lanza el sidecar del bridge
npm run build-bridge     # congela el bridge con PyInstaller → src-tauri/binaries/…
npm run tauri:build      # vite build + .app + .dmg (arquitectura del host)
```

El bridge admite `--device leap|pseye|none` (por defecto `leap`); el frontend también cambia el dispositivo en vivo mediante un mensaje de control por WS. **El soporte de PS Eye es opcional** (el bridge protege los imports):
```bash
brew install libusb
.venv/bin/pip install -r bridge/requirements-pseye.txt   # cython + numpy + pseyepy
```

Para firma/notarización, define la identidad Developer ID en `tauri.conf.json` y exporta `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`.

---

## Solución de problemas

**Sin imagen IR (Fase 0)** — confirma que el servicio de Ultraleap está en ejecución, que `./check-leap.sh` imprime `DEVICE(S) CONNECTED`, que el USB del Controller 2 está conectado y que `./setup.sh` instaló los bindings de Python 3.12.

**Falla la conexión del bridge** — ejecuta `.venv/bin/python bridge/leap-bridge.py` y observa stderr por errores de LeapC; reconecta el USB + reinicia el servicio de Ultraleap.

**No llega TUIO** — verifica que el cliente escuche en `127.0.0.1:3333`, que el firewall no bloquee UDP 3333 (`sudo lsof -i :3333`) y que el bridge registre "TUIO sender ready".

**No se detectan toques (LEAP IR)** — pulsa **CAPTURE BG** primero; sube `THRESHOLD` si hay demasiados blobs; baja `MIN AREA` para toques pequeños; alterna **MIRROR X/Y** si la imagen está volteada.

**FPS bajos** — reduce el desenfoque / trabajo de detección; perfila con Chrome DevTools (Performance).

---

## Tecnologías

- **Frontend**: TypeScript 5.7, Vite 6, WebGL (efectos + warp keystone), cero dependencias en runtime
- **Backend**: Python 3.12, LeapC FFI, websockets, python-osc
- **Escritorio**: Tauri 2 (`.app` de macOS opcional)
- **Pruebas**: ejecutor de pruebas nativo de Node (`--experimental-strip-types`)
- **Comunicación**: WebSocket (fotogramas IR), UDP/OSC (toques TUIO)

---

## Enlaces

- [Leap Motion Controller 2](https://leap2.ultraleap.com/) · [Bindings de Python de LeapC](https://github.com/ultraleap/leapc-python-bindings)
- [Protocolo TUIO 1.1](http://www.tuio.org/) · [Vite](https://vitejs.dev/) · [TypeScript](https://www.typescriptlang.org/docs/)
