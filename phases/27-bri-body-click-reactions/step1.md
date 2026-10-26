# Step 1: imagegen-body-sprites

Generate a full-body Bri atlas with ImageGen using the v1 original as the identity reference (prompt in `connector/desktop/assets/bri/generation.md`). Keep the original in `docs/design/assets/`, derive `sprites-v2.webp` without redrawing, and keep status text out of the artwork.

```sh
node --test connector/test/pet-view.test.mjs
```
