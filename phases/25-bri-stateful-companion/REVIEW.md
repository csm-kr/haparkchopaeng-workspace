# Bri stateful companion review — 2026-10-24

The user's plan-first request and subsequent explicit ImageGen request are captured in the dated plan and generation prompt. Main owns status projection; a receive-only pet was selected over revisioned request/subscription IPC. Both design candidates and an independent comparison favored sending only a mode. DOM deduplication and late-subscription/reload checks were retained.

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | User intent and scope | Pass | Slow idle, conceptual connection/working poses and ImageGen artwork; plan precedes implementation. |
| 2 | Entry, recovery and failure flow | Pass | Real main fixture covers default-off, explicit toggle, working → recovering → disconnected, reload and no focus. Existing connector lifecycle tests pass. |
| 3 | Acceptance criteria | Pass | Node: 227 pass, 6 platform/opt-in skips. Direct isolated Electron: 11 real checks pass. No skipped test counted as native success. |
| 4 | Architecture | Pass | Electron main/session remain state owners; no changes to core execution, server APIs, database or app identity. Renderer-safe registry and dedicated preload are packaged. |
| 5 | Rules | Pass | Failure tests preceded implementation; no extra inferred progress/success, no account access or AI requests, no control API in the pet. |
| 6 | Design and security | Pass | Existing lime/graphite identity; local transparent assets, visible Korean labels, fixed drag exclusion, reduced motion and sandbox/CSP checks pass in real Electron. |
| 7 | Documentation | Pass | Plan, prompt/source image, connector README and current design section updated. Historical SVG-only checks are explicitly superseded. |

Evidence: `connector/artifacts/bri-stateful-20261024/result.json`, state/working/reduced-motion captures in the same directory, and `connector/artifacts/bri-node-tests-20261024.log`. Receipts retain platform and cleanup limits. The actual macOS capture is 208×224 pixels for a 104×112 CSS viewport; pixel probes scale accordingly.

Motion review found and fixed two visible artifacts: the greeting layer left the idle body underneath, and replacing the root animation on each mode reset its floating position. Idle now translates only vertically by 3px over 6 seconds. A persistent outer float track and separate inner pose track preserve phase; the native loop endpoints have zero changed pixels under the checker. New RED receipts are `bri-motion-red-20261024` and `bri-vertical-red-20261024`; the final native receipt passes all 11 checks. Exact-time native renderer samples and a local Watch frame review accompany the motion preview. No external vision or transcription service is used.

The initial unmodified baseline had pre-existing face/rim failures under Retina coordinates. The new raster checker validates actual sampled paint on both backdrops, rendered frame changes and transparency rather than obsolete SVG rim geometry. No prior phase is reclassified by this result.

Source implementation and local verification are complete. Packaged installation, authenticated execution, Windows/Linux native behavior, physical dragging and macOS native pointer hover were not verified here. Unrelated concurrent web connection-control changes in the shared worktree were excluded from this review. No commit, deployment, or installer replacement was performed.
