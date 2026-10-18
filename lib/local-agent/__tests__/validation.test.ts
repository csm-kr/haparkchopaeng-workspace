// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DesktopAckSchema, HeartbeatSchema, JobCreateSchema, ProviderSnapshotSchema, ResultSchema, sanitizeProviderSnapshot } from "../validation";

describe("untrusted connector input", () => {
  const ready = { provider: "codex", status: "ready", models: [{ id: "actual-model", name: "Actual model" }], quota: null, observedAt: "2026-10-17T12:00:00.000Z" };
  it("accepts missing quota without inventing zero remaining tokens", () => {
    expect(ProviderSnapshotSchema.parse(ready).quota).toBeNull();
  });
  it("accepts optional actual bridge metadata while retaining the legacy heartbeat contract", () => {
    expect(HeartbeatSchema.parse({ providers: [] })).toEqual({ providers: [] });
    for (const bridgeVersion of ["0.1.5", "0.1.5-preview.1+build.2"]) {
      expect(HeartbeatSchema.parse({ providers: [], bridgeVersion, bridgeArchitecture: "arm64" })).toEqual({ providers: [], bridgeVersion, bridgeArchitecture: "arm64" });
    }
    expect(HeartbeatSchema.safeParse({ providers: [ready], bridgeArchitecture: "x64" }).success).toBe(true);
    for (const bridgeVersion of [null, "", "latest", "v0.1.5", " 0.1.5", "01.1.5", "0.1.5-01", "0.1.5+" + "b".repeat(60), "0.1.5\n", 15]) {
      expect(HeartbeatSchema.safeParse({ providers: [], bridgeVersion }).success).toBe(false);
    }
    for (const bridgeArchitecture of [null, "arm", "ia32", "ARM64", 64]) {
      expect(HeartbeatSchema.safeParse({ providers: [], bridgeArchitecture }).success).toBe(false);
    }
    expect(HeartbeatSchema.safeParse({ providers: [], bridgeVersion: "0.1.5", executable: "PRIVATE_PATH" }).success).toBe(false);
    expect(ProviderSnapshotSchema.safeParse({ ...ready, bridgeVersion: "0.1.5" }).success).toBe(false);
  });
  it("accepts legacy models and bounded actual effort metadata without relaxing strict input", () => {
    const model = { ...ready.models[0], reasoningEfforts: ["low", "high"] };
    expect(ProviderSnapshotSchema.safeParse({ ...ready, models: [model] }).success).toBe(true);
    expect(ProviderSnapshotSchema.safeParse(ready).success).toBe(true);
    for (const reasoningEfforts of [[], ["high; run-shell"], Array(6).fill("high")]) {
      expect(ProviderSnapshotSchema.safeParse({ ...ready, models: [{ ...model, reasoningEfforts }] }).success).toBe(false);
    }
    expect(ProviderSnapshotSchema.safeParse({ ...ready, models: [{ ...model, command: "run-shell" }] }).success).toBe(false);
  });
  it("separates quota observation time from a newer provider-status observation while accepting legacy snapshots", () => {
    const cached = { ...ready, quota: { short: { label: "5h", remainingPercent: 62, resetsAt: null }, weekly: null }, quotaObservedAt: "2026-10-17T10:00:00.000Z" };
    expect(ProviderSnapshotSchema.parse(cached).quotaObservedAt).toBe("2026-10-17T10:00:00.000Z");
    expect(ProviderSnapshotSchema.safeParse(ready).success).toBe(true);
    expect(ProviderSnapshotSchema.safeParse({ ...cached, quotaObservedAt: "just now" }).success).toBe(false);
  });
  it("removes the cached quota timestamp with unavailable quota or provider logout", () => {
    const cached = ProviderSnapshotSchema.parse({ ...ready, quota: { short: { label: "5h", remainingPercent: 62, resetsAt: null }, weekly: null }, quotaObservedAt: "2026-10-17T10:00:00.000Z" });
    expect(sanitizeProviderSnapshot(cached).quotaObservedAt).toBe(cached.quotaObservedAt);
    expect(sanitizeProviderSnapshot({ ...cached, quota: null }).quotaObservedAt).toBeUndefined();
    const loggedOut = sanitizeProviderSnapshot({ ...cached, status: "login_required" });
    expect(loggedOut.models).toEqual([]);
    expect(loggedOut.quota).toBeNull();
    expect(loggedOut.quotaObservedAt).toBeUndefined();
  });
  it("rejects impossible quota percentages and oversized model catalogues", () => {
    expect(ProviderSnapshotSchema.safeParse({ ...ready, quota: { short: { label: "5h", remainingPercent: 101, resetsAt: null }, weekly: null } }).success).toBe(false);
    expect(ProviderSnapshotSchema.safeParse({ ...ready, models: Array.from({ length: 201 }, (_, i) => ({ id: `m${i}`, name: "model" })) }).success).toBe(false);
  });
  it("does not accept arbitrary commands, files, owners or teams in a job request", () => {
    const job = { deviceId: "device", paperId: "paper", provider: "codex", model: "actual-model", prompt: "이 논문을 설명해줘", requestId: "7c6b5273-b53b-4263-a012-afd23ac4a99a" };
    expect(JobCreateSchema.safeParse(job).success).toBe(true);
    expect(JobCreateSchema.safeParse({ ...job, command: "cat .env", teamId: "another-team" }).success).toBe(false);
    expect(JobCreateSchema.safeParse({ ...job, prompt: "" }).success).toBe(false);
  });
  it("requires a real install key at acknowledgement and bounds accumulated results", () => {
    expect(DesktopAckSchema.safeParse({ attemptId: "a", launchToken: "482107", deviceToken: "482107", deviceName: "PC", platform: "windows" }).success).toBe(false);
    expect(ResultSchema.safeParse({ jobId: "j", claimToken: "k", sequence: 1, status: "completed", response: "a".repeat(200_001) }).success).toBe(false);
  });
});
