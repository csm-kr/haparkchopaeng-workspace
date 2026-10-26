# Step 0: drag-anywhere-and-right-click

Read `docs/design/AI_BRIDGE_TRAY_CHARACTER.md` (2026-10-27 section), `connector/desktop/pet-preload.cjs`, `renderer/pet.js`, `renderer/pet.css` and the pet parts of `desktop/main.mjs`.

Write failing tests first: the preload sends only fixed payload-free signals; a left click reacts without signals, a 4px left drag sends start/end without a reaction, a right click opens the app; main accepts signals only from the pet's main frame, follows the real cursor while dragging and stops on release. Then remove the move handle and every OS drag region.

```sh
node --test connector/test/pet-preload.test.mjs connector/test/pet-view.test.mjs connector/test/desktop-tray-main.test.mjs
```
