# Step 0: click-and-handle

Read `docs/design/AI_BRIDGE_TRAY_CHARACTER.md` (2026-10-26 section), `connector/desktop/renderer/bri-state.mjs`, `pet.js`, `pet.html`, `pet.css` and `showPet()` in `connector/desktop/main.mjs`.

Write failing tests first: reaction selection (random, never the previous one, `boop` outside idle/ready), the pet click lifecycle (one pending reset, cleared on mode change) and the pet window options (`acceptFirstMouse`, 104×144). Then limit the drag region to the move handle and add the click handler. No new IPC, preload API or permissions.

```sh
node --test connector/test/bri-state.test.mjs connector/test/pet-view.test.mjs connector/test/desktop-tray-main.test.mjs
```
