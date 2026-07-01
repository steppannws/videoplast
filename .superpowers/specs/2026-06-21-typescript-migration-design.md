# JavaScript → TypeScript Migration — Design

Date: 2026-06-21
Project: videoplaster (Leap-as-IR-camera touch installation; browser ESM app + Python bridge)
Status: approved (brainstorm)

## Goal

Convert the entire `videoplaster/js` front-end (13 source modules + 10 test files,
~1221 LOC) from JavaScript to TypeScript and type it as strictly as practical,
without changing runtime behavior.

## Decisions (from brainstorm)

- **Build tool: Vite.** Vite serves the app in dev (esbuild transpile + HMR) and
  builds for production (`vite build` → `dist/`). It replaces the `python -m
  http.server` step. `server.port: 8000` to keep the existing URL and `run.sh`
  messaging.
- **Type safety gate: `tsc --noEmit`.** Vite/esbuild only strip types; they do
  not type-check. `tsc --noEmit` is the authority for "type as much as possible".
- **Tests: Node native type-stripping.** `node --test
  --experimental-strip-types 'js/*.test.ts'` (Node 22.21 supports it). Keeps
  `node:test` + `node:assert/strict`. No Vitest, no test compile step.
- **Strict mode: `strict: true`** (noImplicitAny, strictNullChecks, etc.).
- **Import specifiers use explicit `.ts` extensions** (`./blobs.ts`, not
  `./blobs.js`) so Vite, `node --test --experimental-strip-types`, and `tsc
  --noEmit` all resolve to the same files. Enabled by
  `allowImportingTsExtensions`.
- **Zero runtime dependencies preserved.** New deps are dev-only: `vite`,
  `typescript`, `@types/node`.
- **`spike/` stays JavaScript** (throwaway Phase-0 feasibility artifact) — out of
  scope.

## tsconfig.json

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
    "types": ["node"]
  },
  "include": ["js/**/*.ts", "vite.config.ts"]
}
```

- `moduleResolution: "bundler"` + `allowImportingTsExtensions` lets source import
  `./x.ts` directly.
- `verbatimModuleSyntax` + `isolatedModules` keep every file independently
  transpilable by esbuild (forces `import type` for type-only imports).
- `lib` DOM/DOM.Iterable covers WebGL, Canvas, `document`, `window`,
  `WebSocket`. `types: ["node"]` covers `node:test`/`node:assert` in the tests.

## vite.config.ts

```ts
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 8000 },
  build: { outDir: "dist" },
});
```

Root is the `videoplaster/` directory (where `index.html` lives). Entry is
`index.html`.

## package.json scripts

```jsonc
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview --port 8000",
    "typecheck": "tsc --noEmit",
    "test": "tsc --noEmit && node --test --experimental-strip-types 'js/*.test.ts'"
  }
}
```

`npm test` is the single done-gate: it fails on any type error OR any failing
assertion.

## Type model (introduced shapes)

Replace the implicit object literals threaded through the pipeline with named
types (exact field names taken from the current code):

- `DetOpt` — `{ threshold, minArea, maxArea, blurAmt, erosionAmt, invert }`.
- `UndistOpt` — `{ on, k1, k2, map }`.
- `MirrorOpt` — `{ x, y }`.
- `Roi` — `{ x, y, w, h }`.
- `Blob` — `{ cx, cy, area, ... }` (from `blobs.js`).
- `TouchEvent` — `{ x, y, strength, state }` with `state: "down" | "move" | "up"`.
- `PinKey` — `"tl" | "tr" | "br" | "bl"`; `Axis` — `"x" | "y"`.
- Corner offset/position records keyed by `PinKey`.
- A `TouchSource` interface (`onTouch`, `start`, `stop`, optional `previewCb`,
  `statusCb`, `roi`, `opt`, `mirror`, `undist`) that `MouseTouchSource`,
  `LeapImageSource`, and `LeapZSource` implement — this is what `app.ts`'s
  `current`/`leapSrc` are typed against.

WebGL/DOM lookups (`getElementById`, `getContext("webgl")`,
`getContext("2d")`) return nullable types under strict; handle nulls explicitly
(narrowing or a typed `mustGet` helper) rather than casting to `any`.

## Files

Created:
- `videoplaster/tsconfig.json`
- `videoplaster/vite.config.ts`
- `videoplaster/.gitignore` — `node_modules/`, `dist/`, `.playwright-mcp/`,
  `vp-*.png`

Renamed `.js` → `.ts` (13 source + 10 tests):
- source: `homography, ir-preprocess, undistort, blobs, tracking, output,
  persist, warp-gl, water-gl, background, touch-source, leap-z-source,
  leap-image-source, ui-overlay, app`
- tests: the 10 `*.test.js`

Modified:
- `videoplaster/index.html` — `src="js/app.js"` → `src="/js/app.ts"`.
- `videoplaster/package.json` — scripts + devDependencies.
- `videoplaster/run.sh` — `npx vite` instead of `python -m http.server`.
- `videoplaster/setup.sh` — add `npm install`.
- `videoplaster/README.md` — Vite-based run/build instructions, updated test
  command.

## Migration sequencing

Leaf-first dependency order so each module type-checks and its tests pass
independently before the next:

`homography → ir-preprocess → undistort → blobs → tracking → output → persist →
warp-gl → water-gl → background → touch-source → leap-z-source →
leap-image-source → ui-overlay → app`

Each module is renamed with its test in the same step; import specifiers updated
to `.ts`. The toolchain (tsconfig, vite, scripts, `.gitignore`, `npm install`)
is established and proven on the FIRST leaf (`homography`) before the rest, to
de-risk the pipeline early.

## Error / edge handling

- Strict null checks surface real nullability in DOM/WebGL lookups — handle by
  narrowing or a small typed helper, never `as any`.
- `verbatimModuleSyntax` requires type-only imports to use `import type`.
- WebGL uniform/attribute locations are nullable — keep existing runtime
  behavior, just type the nullability.

## Testing

- **Type check:** `tsc --noEmit` → zero errors.
- **Unit:** `node --test --experimental-strip-types 'js/*.test.ts'` → all 29
  assertions pass (current suite count), output pristine.
- **Browser smoke (manual, operator-side):** `npm run dev`, open
  `http://localhost:8000/`, confirm the app boots and the recent features work
  (`H` hide, TEST GRID, FIT SCREEN, RESET ANCHORS, pin drag/nudge).

## Out of scope

- `spike/` (stays JavaScript).
- The Python bridge (`bridge/*.py`) — already has its own pytest suite;
  untouched.
- Any behavior change, refactor, or new feature. This is a typed-rename only.
