"use client";

import * as React from "react";
import type { LocalAgentAttemptView, LocalAgentDeviceView, LocalAgentEffort, LocalAgentJobCreateInput, LocalAgentJobView, LocalAgentProvider as ProviderName } from "@/types/local-agent";
import { errorMessage, launchConnector as browserLaunch, localAgentApi, LocalAgentApiError, type LocalAgentApi } from "./client";
import { ConnectionModal } from "./connection-modal";
import { LocalAgentClientResume } from "./client-resume";
import { rememberChatTarget, restoreChatTarget, type ChatTarget } from "./chat-selection";

export type ConnectionPhase = "loading" | "idle" | "creating" | "opening" | "awaiting_code" | "connected" | "offline" | "cancelled" | "expired" | "error" | "login_required";
export interface ModelSelection { provider: ProviderName; model: string }
interface ConnectionValue {
  api: LocalAgentApi;
  phase: ConnectionPhase;
  device: LocalAgentDeviceView | null;
  attempt: LocalAgentAttemptView | null;
  deepLink: string | null;
  message: string | null;
  selectedModel: ModelSelection | null;
  chatTarget: ChatTarget | null;
  effort: LocalAgentEffort;
  setEffort: (effort: LocalAgentEffort) => void;
  job: LocalAgentJobView | null;
  jobBusy: boolean;
  fallback: boolean;
  pairingSecondsLeft: number | null;
  open: () => void;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  refresh: () => Promise<void>;
  disconnect: () => Promise<void>;
  showFallback: () => void;
  resumeFromInstall: () => void;
  selectModel: (selection: ModelSelection) => void;
  submitJob: (paperId: string, prompt: string) => Promise<void>;
  cancelJob: () => Promise<void>;
}
const Context = React.createContext<ConnectionValue | null>(null);

function storageGet(key: string) { try { return window.sessionStorage.getItem(key); } catch { return null; } }
function storagePut(key: string, value: string | null) { try { if (value) window.sessionStorage.setItem(key, value); else window.sessionStorage.removeItem(key); } catch { /* Hint only; authorization stays on server. */ } }
// Share only the non-secret device hint. Every tab must still validate its grant on the server.
function sharedDeviceHint(key: string) { try { return window.localStorage.getItem(key); } catch { return null; } }
function deviceIdFromHint(value: string | null): string | null {
  if (!value || value.length > 1024) return null;
  if (!value.startsWith("{")) return value;
  try {
    const hint = JSON.parse(value);
    return typeof hint?.deviceId === "string" && typeof hint?.revision === "string" ? hint.deviceId : null;
  } catch { return null; }
}
function deviceHintGet(key: string) { return deviceIdFromHint(sharedDeviceHint(key)) ?? storageGet(key); }
function deviceHintPut(key: string, value: string | null, previous: string | null = null) {
  storagePut(key, value);
  try {
    if (value) {
      // A new approval of the same PC must also notify existing tabs and supersede old replies.
      const hint = JSON.stringify({ deviceId: value, revision: crypto.randomUUID() });
      window.localStorage.setItem(key, hint);
      return hint;
    }
    else if (window.localStorage.getItem(key) === previous) window.localStorage.removeItem(key);
  } catch { /* Session storage still restores this tab when shared storage is unavailable. */ }
  return sharedDeviceHint(key);
}
function authorizedFailure(error: unknown) { return error instanceof LocalAgentApiError && (error.status === 401 || error.status === 403); }

export function LocalAgentProvider({ teamId, children, api = localAgentApi, launchConnector = browserLaunch }: {
  teamId?: string | null;
  children: React.ReactNode;
  api?: LocalAgentApi;
  launchConnector?: (url: string) => boolean;
}) {
  // A new team gets a new state tree. Pending replies from the old tree cannot update it.
  return <LocalAgentSession key={teamId ?? "none"} teamId={teamId ?? null} api={api} launch={launchConnector}>{children}</LocalAgentSession>;
}

function LocalAgentSession({ teamId, api, launch, children }: { teamId: string | null; api: LocalAgentApi; launch: (url: string) => boolean; children: React.ReactNode }) {
  const [phase, setPhase] = React.useState<ConnectionPhase>(teamId ? "loading" : "idle");
  const [device, setDevice] = React.useState<LocalAgentDeviceView | null>(null);
  const [attempt, setAttempt] = React.useState<LocalAgentAttemptView | null>(null);
  const [deepLink, setDeepLink] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [selectedModel, setSelectedModel] = React.useState<ModelSelection | null>(null);
  const [chatTarget, setChatTarget] = React.useState<ChatTarget | null>(null);
  const [effort, setEffort] = React.useState<LocalAgentEffort>("medium");
  const [job, setJob] = React.useState<LocalAgentJobView | null>(null);
  const [jobBusy, setJobBusy] = React.useState(false);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [fallback, setFallback] = React.useState(false);
  const [pairingNow, setPairingNow] = React.useState(Date.now);
  const alive = React.useRef(true);
  const epoch = React.useRef(0);
  const starting = React.useRef(false);
  const submitting = React.useRef(false);
  const requestIntent = React.useRef<{ fingerprint: string; requestId: string } | null>(null);
  const attemptRef = React.useRef<LocalAgentAttemptView | null>(null);
  attemptRef.current = attempt;
  const deviceRef = React.useRef(device);
  deviceRef.current = device;
  const chatTargetRef = React.useRef<ChatTarget | null>(null);
  const deviceHintRef = React.useRef<string | null>(null);
  const deviceKey = `hapark.local-agent.device:${teamId}`;
  const attemptKey = `hapark.local-agent.attempt:${teamId}`;
  const effortKey = `hapark.local-agent.effort:${teamId}`;
  const chatTargetKey = `hapark.local-agent.chat-target:${teamId}`;
  const current = (version: number) => alive.current && epoch.current === version;
  const updateChatTarget = React.useCallback((next: ChatTarget | null) => {
    chatTargetRef.current = next; setChatTarget(next);
    storagePut(chatTargetKey, next ? JSON.stringify(next) : null);
  }, [chatTargetKey]);

  const forget = React.useCallback(() => {
    updateChatTarget(null);
    setDevice(null); setAttempt(null); setDeepLink(null); setSelectedModel(null); setJob(null); setJobBusy(false);
    submitting.current = false; requestIntent.current = null;
    deviceHintPut(deviceKey, null, deviceHintRef.current); deviceHintRef.current = null;
    storagePut(attemptKey, null);
  }, [deviceKey, attemptKey, updateChatTarget]);
  const handleFailure = React.useCallback((error: unknown) => {
    setMessage(errorMessage(error));
    if (authorizedFailure(error)) { epoch.current += 1; forget(); setPhase("login_required"); }
    else setPhase("error");
  }, [forget]);
  const acceptDevice = React.useCallback((next: LocalAgentDeviceView, publishHint = false) => {
    const sameDevice = deviceRef.current?.id === next.id;
    updateChatTarget(rememberChatTarget(next, chatTargetRef.current));
    if (publishHint) deviceHintRef.current = deviceHintPut(deviceKey, next.id);
    setDevice(next); storagePut(deviceKey, next.id); setPhase(next.online ? "connected" : "offline"); setMessage(null);
    setSelectedModel((selection) => sameDevice && selection && next.providers.some((provider) => provider.provider === selection.provider && provider.status === "ready" && provider.models.some((model) => model.id === selection.model)) ? selection : null);
  }, [deviceKey, updateChatTarget]);
  const acceptAttempt = React.useCallback((next: LocalAgentAttemptView) => {
    const previous = attemptRef.current;
    if (previous && (next.id !== previous.id || next.version < previous.version)) return;
    attemptRef.current = next; setAttempt(next);
    if (next.status === "connected" && next.device) {
      storagePut(attemptKey, null); setDeepLink(null); setFallback(false); acceptDevice(next.device, true);
    } else if (next.status === "awaiting_code") { setPhase("awaiting_code"); setFallback(false); }
    else if (next.status === "expired" || next.status === "cancelled") {
      setPhase(next.status); setAttempt(null); attemptRef.current = null; setDeepLink(null); storagePut(attemptKey, null);
    } else setPhase("opening");
  }, [acceptDevice, attemptKey]);

  React.useEffect(() => {
    alive.current = true;
    const savedEffort = storageGet(effortKey);
    if (savedEffort === "low" || savedEffort === "medium" || savedEffort === "high" || savedEffort === "xhigh" || savedEffort === "max") setEffort(savedEffort);
    chatTargetRef.current = restoreChatTarget(storageGet(chatTargetKey));
    const revision = epoch.current;
    if (teamId) {
      const savedHint = sharedDeviceHint(deviceKey);
      const savedDevice = deviceHintGet(deviceKey);
      deviceHintRef.current = savedHint;
      void api.status(savedDevice).then(async (status) => {
        if (!current(revision) || sharedDeviceHint(deviceKey) !== savedHint) return;
        if (status.device) {
          // Migrate an authenticated legacy tab hint once, without replacing a peer's approval.
          if (savedHint === null && savedDevice === status.device.id) deviceHintRef.current = deviceHintPut(deviceKey, status.device.id);
          acceptDevice(status.device); return;
        }
        const pending = storageGet(attemptKey);
        if (pending) {
          try {
            const restored = await api.getAttempt(pending);
            if (current(revision) && sharedDeviceHint(deviceKey) === savedHint) acceptAttempt(restored);
            return;
          } catch (error) {
            if (!current(revision) || sharedDeviceHint(deviceKey) !== savedHint) return;
            if (authorizedFailure(error)) throw error;
            storagePut(attemptKey, null);
          }
        }
        if (current(revision)) {
          deviceHintPut(deviceKey, null, savedHint); deviceHintRef.current = null;
          setPhase("idle");
        }
      }).catch((error) => { if (current(revision) && sharedDeviceHint(deviceKey) === savedHint) handleFailure(error); });
    }
    return () => { alive.current = false; epoch.current += 1; };
  // api and team are fixed for this keyed session; callbacks only use that scope.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!teamId) return;
    const sharedDeviceChanged = (event: StorageEvent) => {
      if (event.key !== deviceKey) return;
      try { if (event.storageArea !== window.localStorage) return; } catch { return; }
      if (event.newValue !== sharedDeviceHint(deviceKey) || event.newValue === deviceHintRef.current) return;
      // Invalidate replies from a previous device before checking the newly approved hint.
      const revision = ++epoch.current;
      starting.current = false;
      forget(); setMessage(null);
      deviceHintRef.current = event.newValue;
      const nextDeviceId = deviceIdFromHint(event.newValue);
      storagePut(deviceKey, nextDeviceId);
      if (!nextDeviceId) { setPhase("idle"); return; }
      setPhase("loading");
      void api.status(nextDeviceId).then(status => {
        if (!current(revision) || sharedDeviceHint(deviceKey) !== event.newValue) return;
        if (status.device) acceptDevice(status.device);
        else { forget(); setPhase("idle"); }
      }).catch(error => { if (current(revision) && sharedDeviceHint(deviceKey) === event.newValue) handleFailure(error); });
    };
    window.addEventListener("storage", sharedDeviceChanged);
    return () => window.removeEventListener("storage", sharedDeviceChanged);
  }, [teamId, deviceKey, api, forget, acceptDevice, handleFailure]);

  async function refresh() {
    const revision = epoch.current;
    const hint = deviceHintRef.current;
    if (sharedDeviceHint(deviceKey) !== hint) return;
    try {
      const status = await api.status(deviceRef.current?.id ?? deviceHintGet(deviceKey));
      if (!current(revision) || sharedDeviceHint(deviceKey) !== hint) return;
      if (status.device) acceptDevice(status.device);
      else { forget(); setPhase("idle"); setMessage(null); }
    } catch (error) { if (current(revision) && sharedDeviceHint(deviceKey) === hint) handleFailure(error); }
  }

  const connectionRevision = epoch.current;
  React.useEffect(() => {
    if (!device?.id || !teamId) return;
    let stopped = false;
    let syncing = false;
    const revision = epoch.current;
    const hint = deviceHintRef.current;
    const sync = async () => {
      if (stopped || syncing || sharedDeviceHint(deviceKey) !== hint) return;
      syncing = true;
      try {
        await api.heartbeat(device.id);
        if (stopped || !current(revision) || sharedDeviceHint(deviceKey) !== hint) return;
        const status = await api.status(device.id);
        if (stopped || !current(revision) || sharedDeviceHint(deviceKey) !== hint) return;
        if (status.device) acceptDevice(status.device);
        else { forget(); setPhase("idle"); }
      } catch (error) {
        if (stopped || !current(revision) || sharedDeviceHint(deviceKey) !== hint) return;
        if (authorizedFailure(error)) handleFailure(error);
        else { setPhase("offline"); setMessage("통신이 잠시 끊겼어요. 연결을 다시 확인하고 있어요."); }
      } finally { syncing = false; }
    };
    void sync();
    const interval = setInterval(() => void sync(), 15000);
    const resume = () => { if (document.visibilityState !== "hidden") void sync(); };
    window.addEventListener("focus", resume); document.addEventListener("visibilitychange", resume);
    return () => { stopped = true; clearInterval(interval); window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); };
  }, [api, device?.id, teamId, deviceKey, connectionRevision, acceptDevice, forget, handleFailure]);

  React.useEffect(() => {
    if (!attempt?.id || (phase !== "opening" && phase !== "awaiting_code")) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const revision = epoch.current;
    const hint = deviceHintRef.current;
    const poll = async () => {
      if (stopped || !current(revision) || sharedDeviceHint(deviceKey) !== hint) return;
      try {
        const next = await api.getAttempt(attempt.id);
        if (!stopped && current(revision) && sharedDeviceHint(deviceKey) === hint) { acceptAttempt(next); setMessage(null); }
      } catch (error) {
        if (!stopped && current(revision) && sharedDeviceHint(deviceKey) === hint) {
          if (authorizedFailure(error)) handleFailure(error);
          else setMessage("연결 확인을 다시 시도하고 있어요. 잠시만 기다려 주세요.");
        }
      } finally { if (!stopped && current(revision) && sharedDeviceHint(deviceKey) === hint) timer = setTimeout(() => void poll(), 1000); }
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [api, attempt?.id, phase, deviceKey, acceptAttempt, handleFailure]);

  React.useEffect(() => {
    if (phase !== "opening") return;
    const timer = setTimeout(() => setFallback(true), 8000);
    return () => clearTimeout(timer);
  }, [phase]);

  // Use the server deadline, so suspended tabs and failed polls cannot prolong a code.
  React.useEffect(() => {
    if (phase !== "awaiting_code" || !attempt) return;
    const revision = epoch.current;
    const deadline = Date.parse(attempt.expiresAt);
    const tick = () => {
      if (!current(revision) || attemptRef.current?.id !== attempt.id) return;
      const now = Date.now();
      setPairingNow(now);
      if (!Number.isFinite(deadline) || now >= deadline) {
        epoch.current += 1;
        attemptRef.current = null; setAttempt(null); setDeepLink(null);
        setFallback(false); setMessage(null); setPhase("expired");
        storagePut(attemptKey, null);
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [phase, attempt?.id, attempt?.expiresAt, attemptKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setModalOpen(true);
    if (!teamId || starting.current) return;
    starting.current = true;
    const revision = ++epoch.current;
    const hint = sharedDeviceHint(deviceKey);
    deviceHintRef.current = hint;
    updateChatTarget(null);
    setMessage(null); setFallback(false); setPhase("creating"); setDevice(null); setAttempt(null); attemptRef.current = null; setDeepLink(null); setSelectedModel(null);
    try {
      const next = await api.createAttempt();
      if (!current(revision) || sharedDeviceHint(deviceKey) !== hint) { void api.cancelAttempt(next.id).catch(() => {}); return; }
      attemptRef.current = next; setAttempt(next); storagePut(attemptKey, next.id);
      setDeepLink(next.deepLink); setPhase(next.status === "awaiting_code" ? "awaiting_code" : "opening");
      if (next.status === "connected" && next.device) acceptAttempt(next);
      else if (!launch(next.deepLink)) setFallback(true);
    } catch (error) { if (current(revision) && sharedDeviceHint(deviceKey) === hint) handleFailure(error); }
    finally { if (current(revision)) starting.current = false; }
  }
  async function cancel() {
    const pending = attemptRef.current;
    epoch.current += 1; starting.current = false;
    setAttempt(null); attemptRef.current = null; setDeepLink(null); setFallback(false); setMessage(null); setPhase("cancelled"); storagePut(attemptKey, null);
    if (pending) {
      try { await api.cancelAttempt(pending.id); }
      catch { if (alive.current) setMessage("취소를 확인하지 못했어요. 다시 로그인하면 이전 연결을 사용할 수 없어요."); }
    }
  }
  async function disconnect() {
    const id = deviceRef.current?.id;
    if (!id) return;
    const revision = ++epoch.current;
    forget(); setPhase("idle");
    try { await api.disconnect(id); }
    catch (error) { if (current(revision)) handleFailure(error); }
  }
  function selectModel(selection: ModelSelection) {
    if (phase !== "connected" || !device?.providers.some((provider) => provider.provider === selection.provider && provider.status === "ready" && provider.models.some((model) => model.id === selection.model))) return;
    setSelectedModel(selection);
    updateChatTarget({ deviceId: device.id, ...selection });
  }
  async function submitJob(paperId: string, prompt: string) {
    if (!selectedModel || phase !== "connected" || !device || submitting.current || jobBusy || !paperId || !prompt.trim()) return;
    const revision = epoch.current;
    submitting.current = true;
    const question = { deviceId: device.id, paperId, ...selectedModel, prompt: prompt.trim() };
    const fingerprint = JSON.stringify(question);
    if (requestIntent.current?.fingerprint !== fingerprint) requestIntent.current = { fingerprint, requestId: crypto.randomUUID() };
    const input: LocalAgentJobCreateInput = { ...question, requestId: requestIntent.current.requestId };
    setJobBusy(true); setMessage(null);
    try {
      const next = await api.createJob(input);
      if (current(revision)) { setJob(next); requestIntent.current = null; }
      else void api.cancelJob(next.id).catch(() => {});
    }
    catch (error) { if (current(revision)) { setMessage(errorMessage(error)); if (authorizedFailure(error)) handleFailure(error); } }
    finally { if (current(revision)) { submitting.current = false; setJobBusy(false); } }
  }
  const jobId = job?.id;
  const jobStatus = job?.status;
  React.useEffect(() => {
    if (!jobId || !jobStatus || !["queued", "running"].includes(jobStatus)) return;
    const revision = epoch.current;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api.getJob(jobId);
        if (!stopped && current(revision)) setJob((previous) => previous && previous.id === next.id && previous.version <= next.version ? next : previous);
      } catch (error) { if (!stopped && current(revision) && authorizedFailure(error)) handleFailure(error); }
      finally { if (!stopped && current(revision)) timer = setTimeout(() => void poll(), 1000); }
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [api, jobId, jobStatus, handleFailure]);
  async function cancelJob() {
    if (!job) return;
    const revision = epoch.current;
    try { const next = await api.cancelJob(job.id); if (current(revision)) setJob(next); }
    catch (error) { if (current(revision)) setMessage(errorMessage(error)); }
  }

  const pairingSecondsLeft = phase === "awaiting_code" && attempt
    ? Math.max(0, Math.min(300, Math.ceil((Date.parse(attempt.expiresAt) - pairingNow) / 1000))) : null;
  const value: ConnectionValue = { api, phase, device, attempt, deepLink, message, selectedModel, chatTarget, effort,
    setEffort: (next) => { setEffort(next); storagePut(effortKey, next); }, job, jobBusy, fallback, pairingSecondsLeft,
    open: () => setModalOpen(true),
    resumeFromInstall: () => { setModalOpen(true); if (phase !== "connected" && phase !== "login_required") void start(); },
    start, cancel, refresh, disconnect, showFallback: () => setFallback(true), selectModel, submitJob, cancelJob };
  return <Context.Provider value={value}>{children}<LocalAgentClientResume />{modalOpen && <ConnectionModal onClose={() => setModalOpen(false)} />}</Context.Provider>;
}

export function useLocalAgent() { return React.useContext(Context); }
