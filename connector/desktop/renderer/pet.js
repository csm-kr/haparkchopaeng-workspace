import { BRI_PRESENTATIONS, selectBriReaction } from './bri-state.mjs';

const REACTION_MS = 1200;
// Below this many pixels a press is a click, so a shaky hand still gets a reaction.
// Window coordinates suffice: the window only starts moving once a drag is reported.
const DRAG_THRESHOLD_PX = 4;
const character = document.querySelector('.bri');
const status = document.getElementById('pet-status');
let currentMode, reaction, reactionTimer, press;

function endReaction() {
  clearTimeout(reactionTimer);
  delete document.body.dataset.reaction;
}

function react() {
  reaction = selectBriReaction({ mode: currentMode, previous: reaction });
  endReaction();
  // Reading layout restarts the CSS animation when the same reaction (boop) repeats.
  void character.offsetWidth;
  document.body.dataset.reaction = reaction;
  reactionTimer = setTimeout(endReaction, REACTION_MS);
}

function render(mode) {
  if (typeof mode !== 'string' || !Object.hasOwn(BRI_PRESENTATIONS, mode) || mode === currentMode) return;
  currentMode = mode;
  endReaction();
  const presentation = BRI_PRESENTATIONS[mode];
  document.body.dataset.mode = mode;
  character.setAttribute('aria-label', presentation.accessibleLabel);
  status.textContent = presentation.label;
}

function startPress(event) {
  if (event.button !== 0) return;
  press = { x: event.clientX, y: event.clientY, dragging: false };
  character.setPointerCapture(event.pointerId);
}

function movePress(event) {
  if (!press || press.dragging || Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_THRESHOLD_PX) return;
  press.dragging = true;
  window.bri?.startDrag();
}

function endPress(event) {
  if (!press) return;
  const { dragging } = press;
  press = undefined;
  if (dragging) window.bri?.endDrag();
  else if (event.type === 'pointerup') react();
}

render('idle');
character.addEventListener('pointerdown', startPress);
character.addEventListener('pointermove', movePress);
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) character.addEventListener(type, endPress);
character.addEventListener('contextmenu', event => { event.preventDefault(); window.bri?.openApp(); });
const unsubscribe = window.bri?.onState(render);
window.addEventListener('pagehide', () => unsubscribe?.(), { once: true });
