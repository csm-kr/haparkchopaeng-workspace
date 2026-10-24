# Bri sprites v1

Built-in ImageGen, 2026-10-24. Reference: existing Bri captured in the isolated Electron renderer. Transparent 4×2 atlas. The selected atlas and derived display-size assets belong to this project. State labels are rendered by the app, not embedded in images.

Reading order: idle open, idle blink, ready/greeting, connecting, working A, working B, recovering, disconnected/error.

Original: `docs/design/assets/bri-imagegen-v1.png` (1774×887, alpha retained). Display atlas: `sprites-v1.webp` (704×352, 4×2 cells, 176px per cell, shown at 88px). Main-window illustration: first cell as `idle-v1.png`. Derived assets use Sharp resizing and cell extraction; they do not redraw the character. CSP serves these local assets only.

## Prompt

+Use case: stylized-concept.
Asset type: production sprite atlas for the tiny AI Bridge desktop companion "Bri".
Image 1 is the reference for the character's identity and brand colors. Create a cuter, softly rounded, polished toy-like 3D interpretation of that SAME robot. Preserve the recognisable charcoal rounded-square face/body, thick lime green rim, two lime eyes, single antenna with round lime tip, and two little plug-shaped side arms. Add a very gentle friendly personality, soft toy proportions and readable expressive eyes. The robot is the entire character; do not add a human torso or legs.
Deliver ONE precisely aligned sprite atlas, 2048 x 1024 pixels, EXACTLY 4 columns by 2 rows, 8 equal 512 x 512 square cells. Genuine transparent background. No grid lines, no cell borders, no labels, no lettering, no text, no floor, no backdrop, no watermark, no floating decorative particles. Each cell contains exactly one full Bri, wholly within that cell, at the SAME scale, front-facing 3/4 depth but nearly frontal, with identical head/eye/antenna proportions and consistent soft upper-left lighting. Keep the character centered around the exact center of each cell and leave generous transparent margins, at least 12% on every side. NO part crosses a cell boundary. Opaque graphite face remains fully opaque.
Reading order, left to right:
Row 1 cell 1: IDLE A, content gentle small smile, both round eyes open, relaxed arms.
Row 1 cell 2: IDLE B, EXACT same neutral pose as cell 1, just eyes softly closed in a natural blink.
Row 1 cell 3: READY / friendly hover, warmly smiling curved eyes and little raised plug hand greeting, same footprint.
Row 1 cell 4: CONNECTING, curious attentive eyes looking slightly up towards the antenna, hopeful small mouth, tiny attentive head tilt.
Row 2 cell 1: WORKING A, focused intent eyes looking down, tiny matching charcoal-and-lime keyboard immediately in front under face, left plug hand on keys, right hand slightly raised. Very cute busy concentration, not angry.
Row 2 cell 2: WORKING B, EXACT same head, eyes, keyboard position and scale as WORKING A; switch hand positions subtly to make a two-frame typing loop. Only hands and one tiny keyboard key highlight change.
Row 2 cell 3: RECONNECTING, gently concerned curious eyes looking sideways as if searching for connection, antenna tilted a little, small uncertain mouth, no keyboard, no tears.
Row 2 cell 4: DISCONNECTED / connection error, slightly drooping antenna, small concerned eyes and gentle downturned mouth, plug hands lowered, sympathetic and cute, no tears or alarm effects.
Color palette stays charcoal graphite #16181A and vivid soft lime #C6FF3D with subtle lime cheek accents; no blue or purple accents. Strong silhouette and clean readable details at 88px. This is a coherent reusable sprite sheet, NOT a concept board. Keep all 8 sprites visibly the same individual with the same head shape, face layout and materials.
