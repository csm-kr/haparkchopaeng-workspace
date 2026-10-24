# Step 2: native-verification

Read `connector/scripts/pet-qa.mjs`, the preceding steps and `docs/design/AI_BRIDGE_TRAY_CHARACTER.md`.

Run the real isolated Electron renderer using the product pet preload and local assets. Cover all seven modes, two actually different work frames, visible work/recovery/disconnection text, label bounds, light/dark contrast with Retina-aware coordinates, transparency, hover return, actual elapsed blink/greeting cycles, reduced motion, drag exclusion and focus. Preserve owned-process/profile cleanup and zero account/CLI/network activity. Update obsolete SVG-only checks for the generated raster contract while keeping the same behavioral protections.

Acceptance criteria:

```sh
node connector/scripts/pet-qa.mjs --evidence-dir=connector/artifacts/bri-stateful-20261024
node --test connector/test/*.test.mjs
git diff --check -- connector docs/design/AI_BRIDGE_TRAY_CHARACTER.md phases/25-bri-stateful-companion
```

Review evidence and scope in `REVIEW.md`. Do not claim physical dragging, macOS native pointer hover, Windows/Linux, production authentication, packaging or installation from this local renderer run.
