# Step 1: native-verification

Run the isolated Electron pet QA, then the connector suite. Synthetic input events are not evidence of physical dragging, Windows/Linux window movement or an installed release.

```sh
cd connector && CONNECTOR_PET_NATIVE_QA=1 node --test test/pet-renderer.test.mjs && npm test
```
