import { presentQuota, formatResetTime } from './quota.mjs';
const $ = id => document.getElementById(id);
let state, submission = false, providerKey = '';
const statusNames = { ready: '사용 가능', not_installed: '설치 필요', login_required: '로그인 필요', limited: '한도 도달', error: '확인 필요' };
const stageNames = { connected: '연결됨', pairing: '번호 확인', opening: '연결 중', idle: '대기 중', error: '연결 확인', authorization_required: '재연결 필요' };

function render(value) {
  if (!value || typeof value.stage !== 'string') return;
  const previousStage = state?.stage, newAttempt = state?.attemptId !== value.attemptId;
  if (!state || newAttempt || value.stage !== 'pairing') { $('code').value = ''; $('code').removeAttribute('aria-invalid'); $('code-error').textContent = ''; }
  state = value;
  $('companion').hidden = ['pairing', 'connected'].includes(state.stage);
  if (state.appName) { document.title = state.appName; $('app-name').textContent = state.appName; }
  $('site-name').textContent = state.siteName;
  $('title').textContent = state.title; $('description').textContent = state.description;
  $('status').textContent = stageNames[state.stage] ?? '확인 중'; $('status').dataset.ready = String(state.stage === 'connected'); $('status').dataset.stage = state.stage;
  $('target').hidden = !['pairing', 'connected'].includes(state.stage);
  $('target-site').textContent = state.siteName; $('target-account').textContent = [state.memberName, state.teamName].filter(Boolean).join(' · '); $('target-device').textContent = state.deviceName;
  $('pairing').hidden = state.stage !== 'pairing'; $('providers').hidden = state.stage !== 'connected';
  $('idle-actions').hidden = ['connected', 'pairing', 'opening'].includes(state.stage); $('pause').hidden = state.stage !== 'connected';
  $('auto-start').checked = state.autoStart === true; $('auto-start').disabled = state.platform === 'linux'; $('pet').checked = state.pet === true;
  $('lifetime-note').textContent = state.stage === 'connected'
    ? state.closeToTray ? '창을 닫으면 트레이에서 연결을 유지해요. 트레이에서 다시 열거나 종료할 수 있어요.' : '창을 닫으면 연결도 종료돼요. 다음에는 웹 버튼으로 다시 열 수 있어요.'
    : '필요할 때 웹 버튼으로 실행할 수 있어요.';
  if (state.stage === 'pairing') { $('code-error').textContent = state.message ?? ''; $('code').setAttribute('aria-invalid', String(!!state.message)); } else $('message').textContent = state.message ?? '';
  const nextProviderKey = JSON.stringify((state.providers ?? []).map(provider => ({ ...provider, quotaPresentation: presentQuota(provider).state })));
  if (nextProviderKey !== providerKey) { providerKey = nextProviderKey; $('provider-list').replaceChildren(...(state.providers ?? []).map(providerRow)); }
  updateButton();
  if (state.stage === 'pairing' && (newAttempt || previousStage !== 'pairing')) queueMicrotask(() => $('code').focus());
  if (state.stage === 'connected' && previousStage !== 'connected') queueMicrotask(() => $('refresh').focus());
  if (['idle','authorization_required','error'].includes(state.stage) && previousStage !== state.stage) queueMicrotask(() => $('open-web').focus());
}

function providerRow(provider) {
  const row = document.createElement('div'); row.className = 'provider';
  const info = document.createElement('div'); const name = document.createElement('div'); name.className = 'provider-name'; name.textContent = provider.provider === 'codex' ? 'Codex' : 'Claude Code';
  const meta = document.createElement('div'); meta.className = 'provider-meta'; meta.textContent = provider.status === 'ready' ? `모델 ${provider.models.length}개 · 웹에서 선택` : provider.message ?? 'PC에서 CLI를 확인해 주세요.'; info.append(name, meta);
  const tools = document.createElement('div'); tools.className = 'provider-tools';
  const status = document.createElement('span'); status.className = 'provider-state'; status.dataset.ready = String(provider.status === 'ready'); status.textContent = statusNames[provider.status] ?? '확인 중'; tools.append(status);
  if (provider.status === 'ready') tools.append(quotaControl(provider));
  else { const help = document.createElement('button'); help.className = 'text-button'; help.type = 'button'; help.textContent = '안내'; help.addEventListener('click', () => window.connector.help(provider.provider)); tools.append(help); }
  row.append(info, tools); return row;
}

function quotaControl(provider) {
  const presentation = presentQuota(provider);
  const anchor = document.createElement('div'); anchor.className = 'quota-anchor';
  const button = document.createElement('button'); button.type = 'button'; button.className = 'quota-trigger'; button.setAttribute('aria-label', `${provider.provider === 'codex' ? 'Codex' : 'Claude Code'} 구독 사용 한도`); button.setAttribute('aria-expanded', 'false');
  const popup = document.createElement('div'); popup.className = 'quota-popover'; popup.hidden = true; popup.id = `quota-${provider.provider}`; popup.setAttribute('role', 'tooltip'); button.setAttribute('aria-describedby', popup.id);
  for (const value of presentation.windows.length ? presentation.windows : [null]) {
    const known = !!value;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.classList.add('quota-ring'); svg.dataset.stale = String(presentation.state === 'stale'); svg.setAttribute('aria-hidden', 'true');
    for (const arc of [false, true]) { const circle = document.createElementNS(svg.namespaceURI, 'circle'); for (const [name, value] of Object.entries({ cx: 12, cy: 12, r: 9, pathLength: 100 })) circle.setAttribute(name, String(value)); if (arc) { circle.classList.add('arc'); circle.setAttribute('stroke-dasharray', `${known ? value.remainingPercent : 0} 100`); } svg.append(circle); }
    button.append(svg);
    const line = document.createElement('p'); line.textContent = known ? `${value.label} · ${value.remainingPercent}% 남음${value.resetsAt ? ` · ${formatResetTime(value.resetsAt)} 초기화` : ''}` : '구독 한도 정보 미제공'; popup.append(line);
  }
  const note = document.createElement('p'); note.textContent = `${presentation.state === 'stale' ? '이전 확인값이에요. ' : ''}CLI가 제공한 구독 한도이며 잔여 토큰 수는 아니에요.${presentation.state !== 'unavailable' ? ` ${new Intl.DateTimeFormat('ko-KR',{hour:'numeric',minute:'2-digit'}).format(new Date(provider.quotaObservedAt ?? provider.observedAt))} 확인` : ''}`; popup.append(note);
  const show = open => { popup.hidden = !open; button.setAttribute('aria-expanded', String(open)); };
  anchor.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') show(true); });
  anchor.addEventListener('pointerleave', () => { if (!button.matches(':focus-visible')) show(false); });
  button.addEventListener('focus', () => { if (button.matches(':focus-visible')) show(true); }); button.addEventListener('blur', () => show(false));
  button.addEventListener('keydown', event => { if (event.key === 'Escape') show(false); }); button.addEventListener('click', () => { if (matchMedia('(hover:none)').matches) show(popup.hidden); });
  anchor.append(button, popup); return anchor;
}

function updateButton() { $('pair-button').disabled = submission || !/^\d{6}$/.test($('code').value); $('pair-button').textContent = submission ? '확인하고 있어요' : '번호 확인하고 연결'; }
$('code').addEventListener('input', () => { $('code').value = $('code').value.replace(/\D/g, '').slice(0,6); $('code-error').textContent = ''; $('code').removeAttribute('aria-invalid'); updateButton(); });
$('code').addEventListener('paste', event => { event.preventDefault(); $('code').value = (event.clipboardData?.getData('text') ?? '').replace(/\D/g,'').slice(0,6); $('code-error').textContent = ''; $('code').removeAttribute('aria-invalid'); updateButton(); });
$('pairing').addEventListener('submit', async event => { event.preventDefault(); if (submission || !/^\d{6}$/.test($('code').value)) return; submission = true; updateButton(); try { const result = await window.connector.pair($('code').value); if (!result.ok) { $('code-error').textContent = result.message; $('code').setAttribute('aria-invalid','true'); } } finally { submission = false; updateButton(); } });
for (const [id, method] of [['open-web','openWeb'],['refresh','refresh'],['pause','pause'],['quit','quit']]) $(id).addEventListener('click', () => window.connector[method]());
for (const [id, method] of [['auto-start','autoStart'],['pet','pet']]) $(id).addEventListener('change', async () => { const result = await window.connector[method]($(id).checked); if (!result.ok) { $(id).checked = !$(id).checked; $('message').textContent = result.message; } });
window.connector.onState(render); window.connector.state().then(render);
const closeQuotaPopovers = event => { for (const popup of document.querySelectorAll('.quota-popover')) if (event.type === 'keydown' || !popup.parentElement.contains(event.target)) { popup.hidden = true; popup.parentElement.querySelector('button').setAttribute('aria-expanded','false'); } };
document.addEventListener('pointerdown', closeQuotaPopovers);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeQuotaPopovers(event); });
