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

# Bri sprites v2 (full body)

Codex CLI built-in ImageGen, 2026-10-26, user request: give Bri a body and random click reactions. Reference: the v1 original atlas. Supersedes v1 in the pet; the main window still uses `idle-v1.png`.

Reading order (4 columns x 3 rows): idle open, idle blink, connecting, recovering / working A, working B, disconnected/error, wave / jump, giggle, dance, wink. Wave doubles as the 14-second idle greeting.

Original: `docs/design/assets/bri-imagegen-v2-body.png` (1254x1254, alpha retained; the generator ignored the requested 1536 size and the 88% baseline). Display atlas: `sprites-v2.webp` (800x720, 4x3, 200x240 px per cell, shown at 100x120 CSS px). Derivation with Sharp, no redrawing: the 12 opaque (alpha >= 64) components are the 12 characters; pixels within 4 px of a character are kept and the faint background specks are dropped; every character is scaled by 2*104/371, its feet set on a baseline 12 px above the cell bottom, and its face band (80-130 px below the antenna tip) centred horizontally. Blink and typing pairs land on identical offsets.

## Prompt

+Use case: stylized-concept.
Asset type: production sprite atlas for the tiny AI Bridge desktop companion "Bri".
Image 1 is the reference for the character's identity, materials and brand colors (the current head-only Bri). Create the SAME Bri, now as a full-body, short-legged, cute, softly rounded, polished toy-like 3D robot. Keep the head exactly recognisable: charcoal rounded-square face with thick lime green rim, two lime eyes, lime cheek accents, single antenna with round lime tip. The head stays big (chibi proportions, head about 55% of the total height). Add a small rounded charcoal graphite torso, narrower than the head, with a lime rim and one small round lime chest light. The two little plug-shaped arms from the reference now attach at the torso shoulders. Two short stubby legs with rounded lime-trimmed feet. Same soft toy materials, same soft upper-left lighting. No human features, no clothes.

Deliver ONE precisely aligned sprite atlas, 1536 x 1536 pixels, EXACTLY 4 columns by 3 rows of 12 equal PORTRAIT cells, each cell 384 px wide x 512 px tall. Genuine transparent background. No grid lines, no cell borders, no labels, no lettering, no text, no floor, no backdrop, no cast floor shadow, no watermark, no floating decorative particles, no hearts, no sparkles. Each cell contains exactly one full Bri from antenna tip to feet, wholly inside that cell, at the SAME scale, nearly frontal 3/4 view. Center each Bri horizontally in its cell. Grounded poses stand with the feet on the same invisible baseline at about 88% of the cell height. Leave transparent margins of at least 10% on the left and right and at least 6% at the top. NO part crosses a cell boundary. The graphite face and torso stay fully opaque.

Reading order, left to right, top to bottom:
Row 1 cell 1: IDLE A. Standing relaxed, both round eyes open, gentle small smile, arms relaxed down at the sides.
Row 1 cell 2: IDLE B. EXACT same pose, position and scale as cell 1; only the eyes are softly closed in a natural blink.
Row 1 cell 3: CONNECTING. Standing, curious attentive eyes looking slightly up towards the antenna, hopeful small mouth, tiny attentive head tilt, one plug hand raised near the head as if listening.
Row 1 cell 4: RECONNECTING. Standing, gently concerned curious eyes looking sideways as if searching for a connection, antenna tilted a little, small uncertain mouth, no tears.
Row 2 cell 1: WORKING A. Sitting on the baseline with the short legs forward, a tiny matching charcoal-and-lime keyboard on its lap, focused intent eyes looking down at it, left plug hand on the keys, right hand slightly raised. Cute busy concentration, not angry.
Row 2 cell 2: WORKING B. EXACT same seated body, head, eyes, keyboard position and scale as WORKING A; switch hand positions subtly to make a two-frame typing loop. Only the hands and one tiny key highlight change.
Row 2 cell 3: DISCONNECTED / connection error. Standing, slightly drooping antenna, small concerned eyes, gentle downturned mouth, plug hands lowered, shoulders slightly slumped. Sympathetic and cute, no tears or alarm effects.
Row 2 cell 4: REACTION WAVE. Standing, warmly smiling curved happy eyes, open little smile, one plug hand raised high and waving.
Row 3 cell 1: REACTION JUMP. Joyful jump: both feet clearly off the baseline (body raised by about 8% of the cell height), both arms up, big happy smile. Still fully inside the cell.
Row 3 cell 2: REACTION GIGGLE. Standing, tickled and giggling, eyes squeezed into happy arcs, wide grin, both plug hands near the mouth, body very slightly squished.
Row 3 cell 3: REACTION DANCE. Playful little dance: one leg lifted, arms out to opposite sides, happy eyes, cheerful smile.
Row 3 cell 4: REACTION WINK. Standing proudly with both plug hands on the hips, one eye winking, confident cheeky smile.

Color palette stays charcoal graphite #16181A and vivid soft lime #C6FF3D with subtle lime cheek accents; no blue or purple accents. Strong silhouette and clean readable details when shown about 90 px wide. This is a coherent reusable sprite sheet, NOT a concept board. All 12 sprites must be visibly the same individual with the same head shape, face layout, body proportions and materials.
