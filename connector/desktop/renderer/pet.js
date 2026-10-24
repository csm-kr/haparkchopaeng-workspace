import { BRI_PRESENTATIONS } from './bri-state.mjs';

const character = document.querySelector('.bri');
const status = document.getElementById('pet-status');
let currentMode;

function render(mode) {
  if (typeof mode !== 'string' || !Object.hasOwn(BRI_PRESENTATIONS, mode) || mode === currentMode) return;
  currentMode = mode;
  const presentation = BRI_PRESENTATIONS[mode];
  document.body.dataset.mode = mode;
  character.setAttribute('aria-label', presentation.accessibleLabel);
  status.textContent = presentation.label;
}

render('idle');
const unsubscribe = window.bri?.onState(render);
window.addEventListener('pagehide', () => unsubscribe?.(), { once: true });
