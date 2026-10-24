# Step 0: display-state

Read `connector/desktop/main.mjs`, `connector/core/runtime.mjs`, `connector/desktop/renderer/bri-state.mjs` and `connector/desktop/pet-preload.cjs`.

Implement the user's plan in `docs/superpowers/plans/2026-10-24-bri-stateful-companion.md`. Derive the finite display mode in main. Recovery and loss of permission outrank job occupancy; a new app connection never inherits the prior job. Do not infer success from a cleared ID. Send only the primitive mode through the dedicated receive-only preload. Preserve opt-in, inactive showing, drag and existing lifetime behavior. Include the preload in the package.

Acceptance criteria:

```sh
node --test connector/test/bri-state.test.mjs connector/test/pet-preload.test.mjs connector/test/desktop-tray-main.test.mjs connector/test/desktop-version-display.test.mjs
```

The tests exercise real main with isolated Electron/session fixtures, cached late subscriptions, reload publication, no extra controls or sensitive fields, and the main window's work/recovery label. Fixtures do not demonstrate authenticated execution.
