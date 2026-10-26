# Step 2: native-verification

Run the isolated Electron pet QA and review its captures, then the connector suite. Synthetic input events and captures are not evidence of OS pointer clicks, physical dragging, other platforms or an installed release.

```sh
cd connector && CONNECTOR_PET_NATIVE_QA=1 node --test test/pet-renderer.test.mjs && npm test
```
