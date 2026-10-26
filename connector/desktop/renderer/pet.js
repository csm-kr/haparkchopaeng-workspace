import { BRI_PRESENTATIONS, selectBriReaction } from './bri-state.mjs';

const REACTION_MS = 1200;
const character = document.querySelector('.bri');
const status = document.getElementById('pet-status');
let currentMode, reaction, reactionTimer;

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

render('idle');
character.addEventListener('click', react);
const unsubscribe = window.bri?.onState(render);
window.addEventListener('pagehide', () => unsubscribe?.(), { once: true });
