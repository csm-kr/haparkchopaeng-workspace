// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DesktopAckSchema, JobCreateSchema, ProviderSnapshotSchema, ResultSchema, sanitizeProviderSnapshot } from "../validation";

describe("untrusted connector input", () => {
  const ready = { provider: "codex", status: "ready", models: [{ id: "actual-model", name: "Actual model" }], quota: null, observedAt: "2026-10-17T12:00:00.000Z" };
  it("accepts missing quota without inventing zero remaining tokens", () => {
    expect(ProviderSnapshotSchema.parse(ready).quota).toBeNull();
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
