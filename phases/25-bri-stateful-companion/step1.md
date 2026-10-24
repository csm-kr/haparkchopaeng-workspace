# Step 1: imagegen-sprites

Read the plan, `connector/desktop/renderer/pet.html`, `pet.js`, `pet.css` and `connector/desktop/assets/bri/generation.md`.

Use built-in ImageGen with the existing Bri identity as reference. Preserve generated transparency and save the selected original in the repository. Derive an eight-cell atlas for 88px display: idle, blink, greeting, connecting, work A/B, recovery and disconnection. Keep idle slow, work unmistakable, status text out of the artwork, and repeat animations disabled under reduced motion. Avoid duplicate live announcements from unchanged heartbeat states. No changes to inference or task results.

Acceptance criteria:

```sh
node --test connector/test/pet-view.test.mjs
node --check connector/desktop/renderer/pet.js
```

Real visual and motion verification belongs to step 2. Asset metadata and DOM fixtures alone do not prove appearance.
