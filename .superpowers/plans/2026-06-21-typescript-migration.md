# JavaScript → TypeScript Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the entire `videoplaster/js` front-end (13 source modules + 10 test files) to strict TypeScript, served by Vite, with no runtime behavior change.

**Architecture:** Author `.ts` with explicit `.ts` import specifiers. Vite (esbuild) serves/builds the browser app; `tsc --noEmit` is the type-safety gate; tests run on Node's native type-stripping (`node --test --experimental-strip-types`). Migrate bottom-up (leaves first) so each migrated module only imports already-migrated `.ts`, keeping `tsc` clean at every step; the only mixed hop is a not-yet-migrated `.js` importer loading a `.ts` module, which Vite and Node strip-types both resolve.

**Tech Stack:** TypeScript (strict), Vite, Node 22.21 `node:test` + `--experimental-strip-types`, WebGL/Canvas2D, dev-only deps `vite` + `typescript` + `@types/node`.

## Global Constraints

- Node 22.21; run all commands from `videoplaster/`.
- Tests: `node --test --experimental-strip-types <globs>` using `node:test` + `node:assert/strict`. NOT Vitest.
- Type gate: `tsc --noEmit` must report zero errors. `strict: true`.
- Import specifiers use explicit `.ts` extensions (`./blobs.ts`).
- Type-only imports must use `import type` (`verbatimModuleSyntax` + `isolatedModules`).
- Never silence a strict error with `as any` or `// @ts-ignore`; narrow nulls or use the provided `el<T>()` helper.
- Zero runtime dependencies. New deps are dev-only.
- No behavior change, no refactor — typed rename only. `spike/` and `bridge/` are untouched.
- Avoid the lib.dom name clashes: our touch event type is `TouchEv` (not `TouchEvent`), our blob type is `DetBlob` (not `Blob`).

---

## File Structure

- **Create** `tsconfig.json`, `vite.config.ts`, `.gitignore`, `js/types.ts` (shared data shapes).
- **Rename** 13 source `.js`→`.ts` and 10 `*.test.js`→`*.test.ts`, adding types in place.
- **Modify** `index.html` (script src), `package.json` (scripts + devDeps), `run.sh`, `setup.sh`, `README.md`.
- Migration order (leaf-first): `homography → {blobs,tracking,ir-preprocess,undistort} → touch-source → {warp-gl,water-gl} → {output,persist,background,ui-overlay} → {leap-z-source,leap-image-source} → app`.

---

## Task 1: Toolchain + first leaf (`homography`) — pipeline de-risk

**Files:**
- Create: `videoplaster/tsconfig.json`, `videoplaster/vite.config.ts`, `videoplaster/.gitignore`, `videoplaster/js/types.ts`
- Modify: `videoplaster/package.json`
- Rename+type: `videoplaster/js/homography.js` → `homography.ts`, `videoplaster/js/homography.test.js` → `homography.test.ts`
- Modify (importer specifier): `videoplaster/js/warp-gl.js` (still `.js` this task)

**Interfaces:**
- Produces: the toolchain; `js/types.ts` exports (consumed by later tasks):
  `PinKey`, `Axis`, `TouchState`, `Roi`, `DetOpt`, `UndistOpt`, `MirrorOpt`, `DetBlob`, `TouchEv`.
- `homography.ts` keeps its exports `computeH(src, dst)`, `inv3(m)` (now typed).

- [ ] **Step 1: Create `videoplaster/tsconfig.json`**

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["js/**/*.ts", "vite.config.ts"]
}
```

- [ ] **Step 2: Create `videoplaster/vite.config.ts`**

```ts
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 8000 },
  build: { outDir: "dist" },
});
```

- [ ] **Step 3: Create `videoplaster/.gitignore`**

```gitignore
node_modules/
dist/
.playwright-mcp/
vp-*.png
```

- [ ] **Step 4: Create `videoplaster/js/types.ts`** (shared shapes — exact field names from the current code)

```ts
// videoplaster/js/types.ts — shared data shapes for the touch pipeline.
// Names avoid lib.dom clashes: TouchEv (not TouchEvent), DetBlob (not Blob).
export type PinKey = "tl" | "tr" | "br" | "bl";
export type Axis = "x" | "y";
export type TouchState = "down" | "move" | "up";

export interface Roi { x: number; y: number; w: number; h: number; }

export interface DetOpt {
  threshold: number; minArea: number; maxArea: number;
  blurAmt: number; erosionAmt: number; invert: boolean;
}

export interface UndistOpt { on: boolean; k1: number; k2: number; map: Int16Array | null; }
export interface MirrorOpt { x: boolean; y: boolean; }

export interface DetBlob { cx: number; cy: number; area: number; bright: number; }

export interface TouchEv {
  id: number; x: number; y: number; z: number;
  strength: number; state: TouchState;
}
```

- [ ] **Step 5: Update `videoplaster/package.json`** (scripts run BOTH test globs during migration; tightened in Task 7)

```jsonc
{
  "name": "videoplaster",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview --port 8000",
    "typecheck": "tsc --noEmit",
    "test": "tsc --noEmit && node --test --experimental-strip-types 'js/*.test.js' 'js/*.test.ts'"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 6: Install deps**

Run: `cd videoplaster && npm install`
Expected: creates `node_modules/` + `package-lock.json`, no errors.

- [ ] **Step 7: Migrate `homography.js` → `homography.ts`**

Rename the file. Type its two functions. The current source operates on point objects `{x, y}` and a 9-number row-major matrix `number[]`. Add:

```ts
// videoplaster/js/homography.ts
export interface Pt { x: number; y: number; }
// computeH: 4 source pts -> 4 dest pts -> 3x3 homography as a length-9 number[]
export function computeH(src: Pt[], dst: Pt[]): number[] { /* existing body, unchanged */ }
export function inv3(m: number[]): number[] { /* existing body, unchanged */ }
```

Keep the existing function bodies verbatim; only add the parameter/return types and the `Pt` interface. If any local uses an implicitly-typed array, give it `number[]`.

- [ ] **Step 8: Rename `homography.test.js` → `homography.test.ts`** and fix its import specifier

Change the import from `from "./homography.js"` to `from "./homography.ts"`. The `node:test`/`node:assert/strict` imports stay as-is. No assertion changes.

- [ ] **Step 9: Update the importer `warp-gl.js`** (still `.js` this task)

In `videoplaster/js/warp-gl.js`, change `import { computeH, inv3 } from "./homography.js";` to `import { computeH, inv3 } from "./homography.ts";`. This is the mixed-graph hop being de-risked (a `.js` file importing a `.ts` module).

- [ ] **Step 10: Verify type-check + full mixed suite (the de-risk gate)**

Run: `cd videoplaster && npm test`
Expected: `tsc --noEmit` passes (only `homography.ts`/`types.ts` are checked); then `node --test` runs ALL tests — the renamed `homography.test.ts` AND the still-`.js` tests, including `warp-gl.test.js` which now transitively loads `homography.ts`. All assertions pass (29 total), output pristine.

If `warp-gl.test.js` fails to resolve `./homography.ts`, STOP and report — the extension strategy needs revisiting before migrating further.

- [ ] **Step 11: Verify the browser build works under Vite**

Run: `cd videoplaster && npm run build`
Expected: `vite build` succeeds, emits `dist/`. (Vite resolves the `.js`→`.ts` import in `app.js`/`warp-gl.js` graph.)

- [ ] **Step 12: Commit**

```bash
git add videoplaster/tsconfig.json videoplaster/vite.config.ts videoplaster/.gitignore \
        videoplaster/js/types.ts videoplaster/package.json videoplaster/package-lock.json \
        videoplaster/js/homography.ts videoplaster/js/homography.test.ts videoplaster/js/warp-gl.js
git commit -m "build: TS toolchain (vite+tsc+node strip-types) + migrate homography leaf"
```

---

## Task 2: Detection leaves — `blobs`, `tracking`, `ir-preprocess`, `undistort`

**Files:**
- Rename+type: `blobs.js`→`.ts` (+`blobs.test.js`→`.ts`), `tracking.js`→`.ts` (+`tracking.test.js`→`.ts`), `ir-preprocess.js`→`.ts` (+`ir-preprocess.test.js`→`.ts`), `undistort.js`→`.ts` (no test)
- Modify (importer specifier): `videoplaster/js/leap-image-source.js` (still `.js`)

**Interfaces:**
- Consumes: `DetOpt`, `DetBlob` from `./types.ts`.
- Produces (typed exports, signatures unchanged):
  - `blobs.ts`: `boxBlur(g: Float32Array, w: number, h: number, r: number): Float32Array`, `morphErode/morphDilate(bin: Uint8Array, w, h, r): Uint8Array`, `grayscaleFromRGBA(data: Uint8ClampedArray, w, h): Float32Array`, `findBlobs(frame: { data: Uint8ClampedArray; width: number; height: number }, opt: DetOpt): { blobs: DetBlob[]; bin: Uint8Array }`.
  - `tracking.ts`: `class BlobTracker` — `constructor(opts?: { maxDist?: number })`, `update(blobs: { x: number; y: number; strength: number }[]): TouchEv[]`.
  - `ir-preprocess.ts`: `subtractBackground(cur: Uint8ClampedArray, bg: Uint8ClampedArray, n: number): Uint8ClampedArray`.
  - `undistort.ts`: `buildUndistMap(w, h, k1, k2): Int16Array`, `applyUndist(data: Uint8ClampedArray, w, h, map: Int16Array): Uint8ClampedArray`.

- [ ] **Step 1: Migrate `blobs.js` → `blobs.ts`**

Rename. Keep bodies verbatim; add the signatures above. Import the shared types: `import type { DetOpt, DetBlob } from "./types.ts";`. Type the internal `blobs` accumulator as `DetBlob[]` and `stk` as `number[]`.

- [ ] **Step 2: Migrate `tracking.js` → `tracking.ts`**

Rename. `import type { TouchEv } from "./types.ts";`. Type `this.tracks` as `Map<number, { x: number; y: number }>`, `events` as `TouchEv[]`. Constructor param `{ maxDist = 0.08 }: { maxDist?: number } = {}`. The pushed event objects already match `TouchEv` (`state` literals `"move"|"up"|"down"`).

- [ ] **Step 3: Migrate `ir-preprocess.js` → `ir-preprocess.ts`** and `undistort.js` → `undistort.ts`

Rename both. Add the signatures above. No shared-type imports needed.

- [ ] **Step 4: Rename the three tests** `blobs.test.js`, `tracking.test.js`, `ir-preprocess.test.js` → `.test.ts`, and change each import specifier to the `.ts` source (e.g. `from "./blobs.ts"`).

- [ ] **Step 5: Update importer specifiers in `leap-image-source.js`** (still `.js`)

Change its four detection imports to `.ts`: `./blobs.ts`, `./tracking.ts`, `./ir-preprocess.ts`, `./undistort.ts`. (Leave `./touch-source.js` for now — migrated in Task 3.)

- [ ] **Step 6: Verify**

Run: `cd videoplaster && npm test`
Expected: `tsc --noEmit` zero errors; all tests pass (the `.test.ts` for blobs/tracking/ir-preprocess plus the still-`.js` suite, including `leap-image-source.test.js` which now loads the migrated `.ts` detection modules).

- [ ] **Step 7: Commit**

```bash
git add videoplaster/js/blobs.ts videoplaster/js/blobs.test.ts \
        videoplaster/js/tracking.ts videoplaster/js/tracking.test.ts \
        videoplaster/js/ir-preprocess.ts videoplaster/js/ir-preprocess.test.ts \
        videoplaster/js/undistort.ts videoplaster/js/leap-image-source.js
git commit -m "refactor: migrate detection leaves (blobs, tracking, ir-preprocess, undistort) to TS"
```

---

## Task 3: `touch-source`

**Files:**
- Rename+type: `touch-source.js`→`.ts` (+`touch-source.test.js`→`.ts`)
- Modify (importer specifiers, still `.js`): `leap-z-source.js`, `leap-image-source.js`

**Interfaces:**
- Consumes: `TouchEv` from `./types.ts`.
- Produces:
  - `clientToSurface(rect: DOMRect, clientX: number, clientY: number): { x: number; y: number }`.
  - `class TouchSource` — `name: string`; `onTouch(cb: (ev: TouchEv) => void): void`; `emit(ev: TouchEv): void`; `start(): void`; `stop(): void`. (`leap-z-source` and `leap-image-source` extend this.)
  - `class MouseTouchSource extends TouchSource` — `constructor(canvas: HTMLCanvasElement)`.

- [ ] **Step 1: Migrate `touch-source.js` → `touch-source.ts`**

Rename. `import type { TouchEv } from "./types.ts";`. Type the base class: `protected _cb: (ev: TouchEv) => void`, `name: string`. For `MouseTouchSource`, type `canvas: HTMLCanvasElement`, the handler fields (`_md/_mm/_mu`) as `(e: MouseEvent) => void`, and `_pos(e: MouseEvent)`. The `e.touches` access does not exist on `MouseEvent` — keep the runtime check but read it via a widened type: `const t = (e as MouseEvent & { touches?: TouchList }).touches;` then branch on `t`. (This preserves behavior without `any`.)

- [ ] **Step 2: Rename `touch-source.test.js` → `.test.ts`** and point its import at `./touch-source.ts`.

- [ ] **Step 3: Update importers** `leap-z-source.js` and `leap-image-source.js` (both still `.js`): change `from "./touch-source.js"` → `from "./touch-source.ts"`.

- [ ] **Step 4: Verify**

Run: `cd videoplaster && npm test`
Expected: zero type errors; all tests pass (incl. `touch-source.test.ts`, and the still-`.js` leap source tests that now load `touch-source.ts`).

- [ ] **Step 5: Commit**

```bash
git add videoplaster/js/touch-source.ts videoplaster/js/touch-source.test.ts \
        videoplaster/js/leap-z-source.js videoplaster/js/leap-image-source.js
git commit -m "refactor: migrate touch-source to TS"
```

---

## Task 4: WebGL modules — `warp-gl`, `water-gl`

**Files:**
- Rename+type: `warp-gl.js`→`.ts` (+`warp-gl.test.js`→`.ts`), `water-gl.js`→`.ts` (no test)
- Modify (importer specifier, still `.js`): `app.js`

**Interfaces:**
- `warp-gl.ts`: keep `cornerPositions(w, h, off): { tl: Pt; tr: Pt; br: Pt; bl: Pt }` and `class WarpGL` — `constructor(gl: WebGLRenderingContext, w: number, h: number)`, `setPinOffset(k: PinKey, axis: Axis, v: number): void`, `resize(w, h): void`, `cornerPositions(): Record<PinKey, { x: number; y: number }>`, `draw(srcTex: WebGLTexture): void`. Its import of `homography.ts` was set in Task 1.
- `water-gl.ts`: `class WaterGL` — `constructor(gl: WebGLRenderingContext)`, public fields `intensity/damp/radius: number`, methods `addDrop(x, y, strength): void`, `setBackground(src: TexImageSource): void`, `step(): void`, `renderToTexture(): WebGLTexture`. (Confirm exact method names against the file; type them as-is.)

- [ ] **Step 1: Migrate `warp-gl.js` → `warp-gl.ts`**

Rename. `import type { PinKey, Axis } from "./types.ts";`. Import `Pt` from `./homography.ts` (value import is fine since it's also a type — but since it's type-only, use `import type { Pt } from "./homography.ts";`; the value imports `computeH, inv3` stay a normal `import`). Change the `homography` specifier to `./homography.ts`. Type the per-corner offset object as `Record<PinKey, { x: number; y: number }>`. WebGL handles: type `this.gl: WebGLRenderingContext`, `this.prog: WebGLProgram`, uniform locations as `WebGLUniformLocation | null` (they already may be null at runtime; keep behavior). For `createProgram()/createShader()/createBuffer()` results (nullable), narrow with `if (!x) throw new Error("…")` matching the existing throw-on-failure style in the file.

- [ ] **Step 2: Migrate `water-gl.js` → `water-gl.ts`**

Rename. Type the constructor `gl: WebGLRenderingContext` and all GL object fields (`WebGLProgram`, `WebGLFramebuffer`, `WebGLTexture`, `WebGLUniformLocation | null`), narrowing nullable `create*()` results with a thrown error as above. Keep all shader strings and logic verbatim.

- [ ] **Step 3: Rename `warp-gl.test.js` → `.test.ts`**, point import at `./warp-gl.ts`. (This test only exercises the pure `cornerPositions`; no GL context needed.)

- [ ] **Step 4: Update `app.js`** (still `.js`): change `from "./warp-gl.js"` → `./warp-gl.ts` and `from "./water-gl.js"` → `./water-gl.ts`.

- [ ] **Step 5: Verify**

Run: `cd videoplaster && npm test`
Expected: zero type errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add videoplaster/js/warp-gl.ts videoplaster/js/warp-gl.test.ts \
        videoplaster/js/water-gl.ts videoplaster/js/app.js
git commit -m "refactor: migrate WebGL modules (warp-gl, water-gl) to TS"
```

---

## Task 5: App-imported leaves — `output`, `persist`, `background`, `ui-overlay`

**Files:**
- Rename+type: `output.js`→`.ts` (no test), `persist.js`→`.ts` (no test), `background.js`→`.ts` (+`background.test.js`→`.ts`), `ui-overlay.js`→`.ts` (+`ui-overlay.test.js`→`.ts`)
- Modify (importer specifier, still `.js`): `app.js`

**Interfaces:**
- `output.ts`: `class TouchEmitter` — `constructor(url?: string)`, `send(ev: TouchEv): void`.
- `persist.ts`: `loadSettings(): Record<string, unknown>`, `getSetting(key: string): unknown`, `saveSetting(key: string, value: unknown): void`, `bindControl(id: string, apply: (v: any) => void, fmt?: (v: any) => string): void`. (The control value is `string | boolean` depending on element; type `apply`/`fmt` params as `string | boolean` and let callers narrow, or keep `any` ONLY here is disallowed — use `string | boolean`.)
- `background.ts`: `class BackgroundCanvas` — `constructor(w: number, h: number)`, `hasMedia: boolean`, `canvas: HTMLCanvasElement`, `resize(w, h): void`, `loadFile(f: File): void`, `clear(): void`, `setTransform(t: { scaleX?: number; scaleY?: number; rot?: number }): void`, `draw(): void`. (Confirm field/method names against the file.)
- `ui-overlay.ts`: keep `nudgeAxis`, `gridLines`, `drawGrid`, `clampPin`, `installOverlay`. Type `gridLines(w, h, spacing): { verticals: number[]; horizontals: number[]; cx: number; cy: number; corners: [number, number][] }`, `nudgeAxis(value: number, dir: -1 | 1, shift: boolean): number`, `drawGrid(ctx: CanvasRenderingContext2D, w, h, spacing): void`, and `installOverlay(opts: InstallOverlayOpts): void` where `InstallOverlayOpts` is declared in this file as `{ panel: HTMLElement; body: HTMLElement; isEditing: () => boolean; onNudge: (axis: Axis, dir: -1 | 1, shift: boolean) => void; onToggleGrid: () => void; persist: (key: string, value: unknown) => void; initialHidden: boolean; idleMs?: number }` (import `Axis` from `./types.ts`).

- [ ] **Step 1: Migrate `output.js` → `output.ts`**

Rename. `import type { TouchEv } from "./types.ts";`. Type `this.ws: WebSocket | null`, `this.url: string`. The empty `catch {}` blocks stay.

- [ ] **Step 2: Migrate `persist.js` → `persist.ts`**

Rename. Type `_cache: Record<string, unknown>`. In `bindControl`, type the element as `HTMLElement | null` and narrow (`if (!el) return;`); the `isCheck`/`isSelect` branches read `(el as HTMLInputElement).checked` / `(el as HTMLInputElement | HTMLSelectElement).value`. `apply: (v: string | boolean) => void`, `fmt?: (v: string | boolean) => string`.

- [ ] **Step 3: Migrate `background.js` → `background.ts`** and rename `background.test.js` → `.test.ts` (point import at `./background.ts`)

Type the constructor and fields per the interface. Media element is `HTMLImageElement | HTMLVideoElement | null`; the 2D context `CanvasRenderingContext2D` (narrow the nullable `getContext("2d")`). Keep logic verbatim.

- [ ] **Step 4: Migrate `ui-overlay.js` → `ui-overlay.ts`** and rename `ui-overlay.test.js` → `.test.ts` (point import at `./ui-overlay.ts`)

Add `import type { Axis } from "./types.ts";`, declare `InstallOverlayOpts` (above), type all helpers. The keydown handler param is `KeyboardEvent`; the `ARROW` map is `Record<string, [Axis, -1 | 1]>`. `idleTimer` is `ReturnType<typeof setTimeout> | null`.

- [ ] **Step 5: Update `app.js`** (still `.js`): change `./output.js`→`./output.ts`, `./persist.js`→`./persist.ts`, `./background.js`→`./background.ts`, `./ui-overlay.js`→`./ui-overlay.ts`.

- [ ] **Step 6: Verify**

Run: `cd videoplaster && npm test`
Expected: zero type errors; all tests pass (incl. `background.test.ts`, `ui-overlay.test.ts`).

- [ ] **Step 7: Commit**

```bash
git add videoplaster/js/output.ts videoplaster/js/persist.ts \
        videoplaster/js/background.ts videoplaster/js/background.test.ts \
        videoplaster/js/ui-overlay.ts videoplaster/js/ui-overlay.test.ts \
        videoplaster/js/app.js
git commit -m "refactor: migrate output, persist, background, ui-overlay to TS"
```

---

## Task 6: Leap sources — `leap-z-source`, `leap-image-source`

**Files:**
- Rename+type: `leap-z-source.js`→`.ts` (+`leap-z-source.test.js`→`.ts`), `leap-image-source.js`→`.ts` (+`leap-image-source.test.js`→`.ts`)
- Modify (importer specifier, still `.js`): `app.js`

**Interfaces:**
- Both extend `TouchSource` (from `./touch-source.ts`).
- `leap-image-source.ts`: keep pure exports `roiMap(cx, cy, w, h, roi: Roi): { u: number; v: number }`, `flipImage(rgba: Uint8ClampedArray, w, h, flipX: boolean, flipY: boolean): Uint8ClampedArray`. `class LeapImageSource` public fields typed with shared types: `opt: DetOpt`, `undist: UndistOpt`, `roi: Roi`, `mirror: MirrorOpt`, `tracker: BlobTracker`, `previewCb: ((rgba: Uint8ClampedArray, w: number, h: number, blobs: DetBlob[]) => void) | null`, `statusCb: ((state: string) => void) | null`, `ws?: WebSocket`, `frame: Uint8ClampedArray | null`, `bg: Uint8ClampedArray | null`. Methods `start/stop/restart/captureBackground(): void`, `setRoi(roi: Roi): void`.
- `leap-z-source.ts`: `class LeapZSource extends TouchSource` (type its fields/methods per the file).

**Interfaces consumed:** `DetOpt`, `UndistOpt`, `Roi`, `MirrorOpt`, `DetBlob` from `./types.ts`; `BlobTracker` from `./tracking.ts`; `findBlobs` from `./blobs.ts`; `subtractBackground` from `./ir-preprocess.ts`; `buildUndistMap, applyUndist` from `./undistort.ts`; `TouchSource` from `./touch-source.ts` (all already `.ts`).

- [ ] **Step 1: Migrate `leap-image-source.js` → `leap-image-source.ts`**

Rename. All five local imports already point at `.ts` (set in Tasks 2-3). Add `import type { DetOpt, UndistOpt, Roi, MirrorOpt, DetBlob } from "./types.ts";`. Type the class fields per the interface. In `_onFrame(buf: ArrayBuffer)`, type `dv`, `gray: Uint8Array`, `rgba: Uint8ClampedArray`; the `mapped` array elements are `{ x: number; y: number; strength: number }`. WebSocket handler params: `MessageEvent` for `onmessage` (use `e.data as ArrayBuffer`).

- [ ] **Step 2: Migrate `leap-z-source.js` → `leap-z-source.ts`**

Rename. Its `./touch-source` import already points at `.ts`. Type the class against the file (WebSocket to `:6437`, hand-tracking Z threshold). Use `import type { TouchEv } from "./types.ts";` if it builds events; type WebSocket handlers and parsed message payloads with explicit interfaces for the fields it reads (no `any`).

- [ ] **Step 3: Rename both tests** `leap-z-source.test.js`, `leap-image-source.test.js` → `.test.ts`; point imports at the `.ts` sources.

- [ ] **Step 4: Update `app.js`** (last `.js` standing): change `./leap-image-source.js`→`./leap-image-source.ts`, `./leap-z-source.js`→`./leap-z-source.ts`.

- [ ] **Step 5: Verify**

Run: `cd videoplaster && npm test`
Expected: zero type errors; all tests pass (incl. both leap source `.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add videoplaster/js/leap-image-source.ts videoplaster/js/leap-image-source.test.ts \
        videoplaster/js/leap-z-source.ts videoplaster/js/leap-z-source.test.ts \
        videoplaster/js/app.js
git commit -m "refactor: migrate leap-image-source and leap-z-source to TS"
```

---

## Task 7: Root `app` + entry/tooling finalize

**Files:**
- Rename+type: `app.js` → `app.ts`
- Modify: `index.html`, `package.json` (tighten test glob), `run.sh`, `setup.sh`, `README.md`

**Interfaces:**
- Consumes every migrated module (all `.ts` now) + shared types from `./types.ts`.
- Produces: nothing imported elsewhere (root entry).

- [ ] **Step 1: Add a typed DOM helper at the top of `app.ts`**

After the imports, add:

```ts
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}
```

- [ ] **Step 2: Migrate `app.js` → `app.ts`**

Rename. Update local import specifiers to `.ts` (`./water-gl.ts`, `./warp-gl.ts`, `./touch-source.ts`, `./output.ts`, `./leap-image-source.ts`, `./leap-z-source.ts`, `./background.ts`, `./persist.ts`, `./ui-overlay.ts`). Add `import type { PinKey, Axis, DetOpt, UndistOpt, MirrorOpt, Roi } from "./types.ts";`. Then:
- Replace `document.getElementById("X")` lookups that are dereferenced (canvas, ui panel) with `el<HTMLCanvasElement>("glCanvas")` etc.; keep the existing `if (el)` guarded optional lookups but type them `HTMLElement | null`.
- `gl` = `glCanvas.getContext("webgl")`; narrow `if (!gl) throw new Error("no webgl");` then type `gl: WebGLRenderingContext`.
- Type module-level state: `detOpt: DetOpt`, `undistOpt: UndistOpt`, `mirrorOpt: MirrorOpt`, `current: TouchSource | null`, `leapSrc: LeapImageSource | null`, `selectedPin: PinKey | null`, `gridOn: boolean`, `fitScreen: boolean`, `pinDrag: PinKey | null`, `dragCorner: PinKey | null`.
- Type the pin tuple array as `[PinKey, Axis, string][]`.
- Event handler params: `MouseEvent`/`TouchEvent` (the lib.dom one) where used; the canvas-position helper reading `e.touches` uses the same widened-type pattern as in `touch-source.ts`.
- Fix each remaining strict error by narrowing or `el<T>()` — never `as any`.

- [ ] **Step 3: Update `index.html`**

Change `<script type="module" src="js/app.js"></script>` to `<script type="module" src="/js/app.ts"></script>`.

- [ ] **Step 4: Tighten the test glob in `package.json`** (all tests are `.test.ts` now)

Change the `test` script to:

```jsonc
"test": "tsc --noEmit && node --test --experimental-strip-types 'js/*.test.ts'"
```

- [ ] **Step 5: Update `run.sh`** — serve via Vite instead of `python -m http.server`

In `videoplaster/run.sh`, replace the final line `"$PYV" -m http.server 8000` with:

```bash
npx vite
```

and update the echo line to `>>> Open:  http://localhost:8000/` (already correct) — keep the bridge launch + trap unchanged.

- [ ] **Step 6: Update `setup.sh`** — add Node deps install

In `videoplaster/setup.sh`, after the Python venv/bridge setup and before the final "done" echo, add:

```bash
echo "→ node deps (vite + typescript)"
npm install
```

- [ ] **Step 7: Update `README.md`**

In the "Run" and "Tests" sections: replace the static-server instructions with `npm run dev` (dev server at `http://localhost:8000/`) and `npm run build` (production `dist/`); change the test command to `npm test` (runs `tsc --noEmit` + `node --test --experimental-strip-types`). Keep the bridge/Leap instructions unchanged.

- [ ] **Step 8: Verify type-check + full suite**

Run: `cd videoplaster && npm test`
Expected: `tsc --noEmit` zero errors across ALL `.ts`; `node --test` runs all 10 `.test.ts`, all assertions pass (29), output pristine. No `.js` source files remain in `js/` (only `.ts`); confirm with `ls js/*.js 2>/dev/null` → only the absence (or just test/source `.ts`).

- [ ] **Step 9: Verify the production build**

Run: `cd videoplaster && npm run build`
Expected: `vite build` succeeds, emits `dist/` with bundled JS from the `.ts` entry.

- [ ] **Step 10: Browser smoke (manual, operator-side)**

Run `cd videoplaster && npm run dev`, open `http://localhost:8000/`. Confirm: app boots (console `app boot`, no errors), `H` hides panel, `TEST GRID`/`FIT SCREEN`/`RESET ANCHORS` work, pin drag + arrow-nudge work. (Bridge optional; MOUSE source needs no hardware.)

- [ ] **Step 11: Commit**

```bash
git add videoplaster/js/app.ts videoplaster/index.html videoplaster/package.json \
        videoplaster/run.sh videoplaster/setup.sh videoplaster/README.md
git commit -m "refactor: migrate app entry to TS; serve via Vite; finalize tooling/docs"
```

---

## Self-Review

**Spec coverage:**
- Vite serve+build, port 8000 → Tasks 1 (config), 7 (run.sh).
- `tsc --noEmit` gate → every task's verify step + `package.json` script (Task 1).
- Node strip-types tests → `package.json` (Task 1), tightened glob (Task 7).
- strict:true, all compiler options → `tsconfig.json` (Task 1).
- `.ts` import specifiers → every rename step + importer-update steps.
- Dev-only deps (vite/typescript/@types/node) → Task 1 package.json.
- Type model (DetOpt/UndistOpt/MirrorOpt/Roi/DetBlob/TouchEv/PinKey/Axis/TouchState) → `types.ts` (Task 1), consumed Tasks 2–7.
- DOM/WebGL nullables handled (no `as any`) → `el<T>()` helper (Task 7) + per-module narrowing guidance.
- index.html/run.sh/setup.sh/README updates → Task 7.
- `.gitignore` (node_modules, dist, screenshots) → Task 1.
- spike/ and bridge/ untouched → not referenced by any task.
- Leaf-first sequencing, toolchain proven on homography first → task order + Task 1 de-risk gate.

**Placeholder scan:** Concrete code given for all new artifacts (tsconfig, vite.config, .gitignore, types.ts, package.json, el helper). Rename tasks specify exact signatures, exact import-specifier edits, exact verify commands. The "confirm exact field/method names against the file" notes (water-gl, background, leap-z) point at existing source the implementer renames in place — not deferred work, but accuracy checks on code being typed.

**Type consistency:** `TouchEv`/`DetBlob`/`DetOpt`/`UndistOpt`/`MirrorOpt`/`Roi`/`PinKey`/`Axis`/`TouchState` defined once in `types.ts` (Task 1) and referenced with identical names in Tasks 2–7. `UndistOpt.map: Int16Array | null` matches `buildUndistMap(): Int16Array` (Task 2) and `LeapImageSource.undist` (Task 6). `TouchEv` shape matches both `MouseTouchSource.emit` (Task 3) and `BlobTracker.update` return (Task 2). Import specifiers consistently `.ts`.
