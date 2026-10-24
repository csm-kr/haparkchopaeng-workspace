import { EventEmitter } from 'node:events';
import { ID_PATTERN } from './security.mjs';

const MAX_RESPONSE = 80000;
const LAPSED_MESSAGE = '웹 연결을 다시 확인하고 있어요.';
const BRIDGE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?![\s\S])/;
export class ConnectorSession extends EventEmitter {
  constructor({ api, identity, adapters, bridgeVersion, bridgeArchitecture, now = Date.now, setIntervalFn = setInterval, clearIntervalFn = clearInterval, maxJobMs = 600000, recoveryMs = 600000 }) {
    super(); this.api = api; this.identity = identity; this.adapters = adapters; this.now = now;
    if (bridgeVersion !== undefined && (typeof bridgeVersion !== 'string' || bridgeVersion.length > 64 || !BRIDGE_VERSION_PATTERN.test(bridgeVersion))) throw new Error('Invalid bridge version.');
    if (bridgeArchitecture !== undefined && !['arm64', 'x64'].includes(bridgeArchitecture)) throw new Error('Invalid bridge architecture.');
    this.bridgeMetadata = { ...(bridgeVersion !== undefined ? { bridgeVersion } : {}), ...(bridgeArchitecture !== undefined ? { bridgeArchitecture } : {}) };
    this.setIntervalFn = setIntervalFn; this.clearIntervalFn = clearIntervalFn; this.maxJobMs = maxJobMs; this.recoveryMs = recoveryMs; this.lapsedAt = null;
    this.state = { status: 'disconnected', providers: [], currentJobId: null, activity: { kind: 'idle' }, message: '' };
    this.leaseExpiresAt = 0; this.timer = null; this.busy = false; this.lastHeartbeat = -Infinity; this.lastClaim = -Infinity;
    this.activeJob = null; this.jobPromise = Promise.resolve(); this.controller = null;
  }
  setProviders(providers) { this.state.providers = providers; this.emitState(); }
  getState() {
    const status = this.state.status === 'connected' && this.now() >= this.leaseExpiresAt ? 'recovering' : this.state.status;
    return { ...this.state, status, activity: status === 'connected' ? { ...this.state.activity } : { kind: 'idle' }, providers: structuredClone(this.state.providers) };
  }
  emitState() { this.emit('state', this.getState()); }
  start(leaseExpiresAt) {
    this.stop(); this.controller = new AbortController();
    if (!this.setLease(leaseExpiresAt)) { this.expire(); return; }
    this.state.status = 'connected'; this.state.message = ''; this.lastHeartbeat = -Infinity; this.lastClaim = -Infinity; this.lapsedAt = null;
    this.timer = this.setIntervalFn(() => { void this.tick(); }, 250);
    this.timer?.unref?.(); this.emitState();
  }
  setLease(value) {
    const expires = Date.parse(value);
    if (!Number.isFinite(expires) || expires <= this.now() || expires > this.now() + 60000) return false;
    this.leaseExpiresAt = expires; return true;
  }
  running() { return this.state.status === 'connected' || this.state.status === 'recovering'; }
  checkLease() { if (!this.running()) return false; if (this.now() >= this.leaseExpiresAt) { this.lapse(); return false; } return true; }
  // Hidden tabs and sleeping PCs renew late. Stop work now, keep asking the server, and resume on a fresh lease.
  lapse() {
    this.lapsedAt ??= this.now();
    if (this.now() - this.lapsedAt >= this.recoveryMs) { this.expire(); return; }
    this.activeJob?.controller.abort();
    if (this.state.status !== 'recovering' || this.state.message !== LAPSED_MESSAGE) { this.state.status = 'recovering'; this.state.message = LAPSED_MESSAGE; this.emitState(); }
  }
  denied(error) {
    if (error?.code === 'WEB_PERMISSION_EXPIRED') { this.leaseExpiresAt = 0; this.lapse(); return true; }
    if ([401, 403, 410].includes(error?.status)) { this.expire(); return true; }
    return false;
  }
  expire() { this.stop('authorization_required', '웹에서 AI 연결을 눌러 다시 연결해 주세요.'); }
  stop(status = 'disconnected', message = '') {
    if (this.timer !== null) this.clearIntervalFn(this.timer); this.timer = null;
    this.controller?.abort(); this.activeJob?.controller.abort();
    this.state.status = status; this.state.message = message; this.state.currentJobId = null; this.state.activity = { kind: 'idle' };
    this.emitState();
  }
  async tick() {
    if (!this.running()) return;
    this.checkLease();
    if (!this.running() || this.busy) return;
    this.busy = true;
    const controller = this.controller;
    try {
      if (this.now() - this.lastHeartbeat >= 5000) {
        this.lastHeartbeat = this.now();
        const heartbeat = await this.api.post('heartbeat', { providers: this.state.providers, ...this.bridgeMetadata }, this.identity, controller.signal);
        if (controller !== this.controller || controller.signal.aborted || !this.running()) return;
        if (!this.setLease(heartbeat?.leaseExpiresAt)) { this.expire(); return; }
        this.lapsedAt = null;
        if (this.activeJob && Array.isArray(heartbeat?.cancelJobIds) && heartbeat.cancelJobIds.includes(this.activeJob.id)) this.activeJob.controller.abort();
        this.state.status = 'connected'; this.state.message = ''; this.emitState();
      }
      if (!this.activeJob && this.now() - this.lastClaim >= 2000 && this.checkLease()) {
        this.lastClaim = this.now();
        const claim = await this.api.post('claim', {}, this.identity, controller.signal);
        if (controller !== this.controller || controller.signal.aborted || !this.checkLease() || !claim) return;
        if (!this.validClaim(claim)) throw new Error('사용할 수 없는 작업 요청이에요.');
        const current = { id: claim.job.id, controller: new AbortController() };
        const onAbort = () => { if (this.activeJob === current) { this.state.activity = { kind: 'stopping' }; this.emitState(); } };
        current.controller.signal.addEventListener('abort', onAbort, { once: true });
        this.activeJob = current; this.state.currentJobId = current.id; this.state.activity = { kind: 'preparing' }; this.emitState();
        this.jobPromise = this.execute(claim, current).finally(() => {
          current.controller.signal.removeEventListener('abort', onAbort);
          if (this.activeJob === current) { this.activeJob = null; this.state.currentJobId = null; this.state.activity = { kind: 'idle' }; this.emitState(); }
        });
      }
    } catch (error) {
      if (controller === this.controller && !controller.signal.aborted && !this.denied(error) && this.checkLease()) { this.state.status = 'recovering'; this.state.message = '연결을 복구하고 있어요.'; this.emitState(); }
    } finally { this.busy = false; }
  }
  validClaim(claim) {
    return claim?.job && ID_PATTERN.test(claim.job.id ?? '') && ['claude', 'codex'].includes(claim.job.provider) && typeof claim.job.model === 'string' && typeof claim.job.prompt === 'string' && claim.job.prompt.length <= 12000 && typeof claim.context === 'string' && claim.context.length <= 250000 && typeof claim.claimToken === 'string' && claim.claimToken.length <= 256 && Date.parse(claim.leaseExpiresAt) > this.now();
  }
  async execute(claim, active) {
    let response = '', sequence = 0, lastPostAt = -Infinity;
    let queue = Promise.resolve();
    const signal = active.controller.signal;
    const post = status => {
      const value = response;
      const input = { jobId: claim.job.id, claimToken: claim.claimToken, sequence: ++sequence, status, response: value };
      queue = queue.catch(() => {}).then(async () => {
        // Full-answer snapshots can supersede a failed partial. Retrying the same sequence is idempotent.
        for (let retry = 0; retry < 3; retry += 1) {
          if (signal.aborted || !this.checkLease()) return;
          try { return await this.api.post('result', input, this.identity, signal); }
          catch (error) {
            if (signal.aborted || this.activeJob !== active) return;
            if (this.denied(error)) throw error;
            if (error.status === 409) { active.controller.abort(); throw error; }
            if (retry === 2 || (error.status && error.status < 500 && error.status !== 429)) throw error;
            await new Promise(resolve => {
              const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
              const timer = setTimeout(finish, 250 * (retry + 1));
              signal.addEventListener('abort', finish, { once: true });
            });
          }
        }
      });
      queue.catch(error => { if (!signal.aborted && this.activeJob === active) this.denied(error); }); lastPostAt = this.now(); return queue;
    };
    const timeout = setTimeout(() => active.controller.abort(), this.maxJobMs); timeout.unref?.();
    try {
      const provider = this.state.providers.find(item => item.provider === claim.job.provider);
      const adapter = this.adapters[claim.job.provider];
      if (!adapter || provider?.status !== 'ready' || !provider.models.some(item => item.id === claim.job.model)) throw new Error('사용 가능한 모델을 다시 선택해 주세요.');
      await adapter.run({ model: claim.job.model, prompt: claim.job.prompt, context: claim.context, signal, onLifecycle: event => {
        if (this.activeJob !== active || signal.aborted || !this.checkLease()) return;
        if (event.kind === 'spawned' && this.state.activity.kind === 'preparing') this.state.activity = { kind: 'running', provider: claim.job.provider, requestedModel: claim.job.model };
        else if (event.kind === 'closed') this.state.activity = { kind: 'finalizing' };
        else return;
        this.emitState();
      }, onText: text => {
        if (signal.aborted || !this.checkLease()) return;
        if (typeof text !== 'string' || response.length + text.length > MAX_RESPONSE) { active.controller.abort(); return; }
        response += text;
        if (this.now() - lastPostAt >= 500) void post('running');
      }, onQuota: quota => { provider.quota = quota; provider.observedAt = new Date(this.now()).toISOString(); provider.quotaObservedAt = quota ? provider.observedAt : undefined; this.emitState(); } });
      if (!signal.aborted && this.checkLease()) { this.state.activity = { kind: 'finalizing' }; this.emitState(); await post('completed'); }
    } catch (error) {
      if (!signal.aborted && this.activeJob === active) this.denied(error);
      if (!signal.aborted && this.checkLease()) {
        this.state.activity = { kind: 'finalizing' }; this.emitState();
        // Only adapter-defined, human-language errors leave the device. Never raw stderr or stack traces.
        const message = error.code === 'LOGIN_REQUIRED' ? 'PC에서 해당 CLI에 다시 로그인해 주세요.' : error.code === 'RATE_LIMITED' ? '구독 사용 한도에 도달했어요.' : error.code === 'BILLING_REQUIRED' ? 'CLI 계정의 이용 권한과 결제 상태를 확인해 주세요.' : 'AI 응답을 완료하지 못했어요. 다시 시도해 주세요.';
        if (error.code === 'LOGIN_REQUIRED') { const p = this.state.providers.find(p => p.provider === claim.job.provider); if (p) { p.status = 'login_required'; p.models = []; p.quota = null; p.quotaObservedAt = undefined; } }
        try { await queue.catch(() => {}); await this.api.post('result', { jobId: claim.job.id, claimToken: claim.claimToken, sequence: ++sequence, status: 'failed', response, error: message }, this.identity, signal); } catch (failure) { if (!signal.aborted && this.activeJob === active) this.denied(failure); }
      }
    } finally { clearTimeout(timeout); await queue.catch(() => {}); }
  }
  async whenIdle() { await this.jobPromise; }
}
