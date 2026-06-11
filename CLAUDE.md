# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

하박조팽 is a **high-fidelity design prototype** for a private research-group collaboration app (4 members: 하수현·박진희·조성민·팽진욱; weekly Saturday seminar). The code in `src/` is a clickable reference of intended look and behavior — **not production code**. The eventual task is to rebuild these designs in a real stack (bundler, component library, router, real state, real video, real PDF pipeline).

Read the three reference docs before substantial work — they are the spec:
- `PRD.md` — product requirements, scope, key product decisions, open questions.
- `README.md` — component/token detail and the prototype-mechanism → production-replacement table.
- `UX_FLOWS.md` — step-by-step flows, state machines, and a conditional-UI cheatsheet.

## Running it

There is **no build, no package manager, no tests, no lint**. The app loads React 18 UMD + `@babel/standalone` from CDNs and transpiles JSX in the browser. To run, serve `src/` over HTTP and open `index.html` (e.g. `python -m http.server` from `src/`, then open the page) — opening the file directly via `file://` will fail because the `<script src>` JSX files are fetched over the network. An internet connection is required for the CDN scripts and fonts.

## Architecture (the non-obvious parts)

**Everything shares one global scope.** There are no ES modules, imports, or exports. `index.html` loads each file with its own `<script>` tag in a **load order that matters**: `data.js` (plain JS, sets `window.*`) → `image-slot.js` (web component) → the JSX files → `app.jsx` last (it mounts). Components are plain top-level functions that reference each other and `window.*` data directly.

**Hooks are aliased per file to avoid collisions.** Because all files share global scope, each destructures React hooks under file-unique names — `useAppState`/`useAppEffect` in `app.jsx`, `useDetailState` in `screens-detail.jsx`, `useAnState` in `analyzer.jsx`, `useMeetState` in `meeting.jsx`, etc. When adding state to a file, follow its existing alias prefix; do not introduce a bare `useState` that could clash with another file.

**`app.jsx` is the whole router and the owner of lifted state.** A `stage` (`auth` → `onboarding` → `app`) gates everything; inside `app`, a `switch (screen)` selects the current screen component. The `switch` is the source of truth for which screens exist and what props they receive (several screens — Lounge, Ideas, Search, CommandPalette, Onboarding — are not in the README table). State that must stay consistent across surfaces lives here and is passed down, most importantly **`live`** (drives the sidebar LIVE pill, the dashboard banner, and the meeting room vs. empty state). Navigation is `navigate(screenId, props)`; transient confirmations are `toast(text)`. Both are threaded into screens as `onNavigate` / `onToast`.

**Data model lives in `data.js`** as `window.TEAM`, `window.PAPERS`, `window.SCHEDULE`, `window.CURRENT_USER`, etc., plus `find*` helpers (`window.findUser`, `window.findPres`, …). This is the shape to formalize into typed models / DB when productionizing.

**Styling is entirely `styles.css`** via CSS custom properties on `:root` and `[data-theme="dark"]`. Theme/density/accent are applied by setting `data-theme` / `data-density` attributes and overriding `--accent*` oklch tokens on `document.documentElement` (see the effect in `app.jsx`). Pull exact token values from `styles.css` rather than hardcoding.

## Things that are intentionally not product features

- **`tweaks-panel.jsx`** is a design-exploration tool (theme/accent/layout switches, flow-jump buttons). The `/*EDITMODE-BEGIN*/ … /*EDITMODE-END*/` markers around `TWEAK_DEFAULTS` in `app.jsx` are edited on disk by that tooling. **Do not port the tweaks panel** to production.
- Prototype stand-ins to replace when productionizing: `getUserMedia` preview tiles, `<image-slot>` figure placeholders, and the in-browser Babel transpile. See the replacement table in `README.md`.

## Domain decisions to preserve (don't "fix" these)

These are deliberate and documented in `PRD.md` — changing them silently breaks the intended product:
- Uploads are **PDF-only**; the old PPTX/MD and "빈 노트 / 아이디어 메모" shortcuts were removed.
- Paper analysis has **two lenses** (연구 / 재구현) with a top toggle; `Figure 분석` is pinned to the bottom of **both** lenses (lens-common notes use `lens: "any"`). Per-section "분석 추가" is per section, not global.
- Schedule **never auto-generates**; empty months stay empty until 일정 짜기. Distinct edit vs. confirmed modes; saving advances the rotation pointer.
- Live defaults to **none** with an explicit start CTA. Streaming is planned on **Cloudflare Stream Live** (app handles broadcast creation, access checks, and player exposure — not the video infra itself).
