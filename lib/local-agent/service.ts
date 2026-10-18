import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, LocalAgentAttempt, LocalAgentDevice, LocalAgentGrant, LocalAgentJob } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http";
import type { LocalAgentAttemptCreated, LocalAgentAttemptView, LocalAgentBridgeMetadata, LocalAgentClaim, LocalAgentDesktopAckInput, LocalAgentDesktopAttempt, LocalAgentDesktopHeartbeat, LocalAgentDesktopPairInput, LocalAgentDeviceView, LocalAgentEffort, LocalAgentJobCreateInput, LocalAgentJobResultInput, LocalAgentJobView, LocalAgentPlatform, LocalAgentProvider, LocalAgentProviderSnapshot, LocalAgentStatus } from "@/types/local-agent";
import { ATTEMPT_MS, DESKTOP_HEARTBEAT_SECONDS, LEASE_MS, MAX_JOB_MS, MAX_PAIR_FAILURES, SNAPSHOT_FRESH_MS, WEB_HEARTBEAT_SECONDS, assertGrantUsable, hashCredential, pairingCode, sameCredential, validateDeviceToken } from "./security";
import { BridgeMetadataSchema, BridgeVersionSchema, EffortSchema, JobCreateSchema, ProviderSnapshotSchema, sanitizeProviderSnapshot } from "./validation";

type Database = Prisma.TransactionClient;
export interface LocalAgentScope { memberId: string; teamId: string; sessionKey: string; sessionExpiresAt: Date }
export interface DesktopIdentity { deviceId: string; deviceToken: string }
const pendingStatuses = ["awaiting_app", "awaiting_code"];
const activeJobStatuses = ["preparing", "queued", "running"];
// Reserved server-only snapshot row; it is never a CLI provider or model catalogue.
const BRIDGE_SNAPSHOT_PROVIDER = "_bridge";
const BRIDGE_ONLINE_MS = 20_000;
const BridgeSnapshotSchema = z.object({ version: z.literal(1), bridgeVersion: BridgeVersionSchema.nullable(), bridgeArchitecture: z.enum(["arm64", "x64"]).nullable() }).strict();
const ChatPreparedSchema = JobCreateSchema.extend({ paperId: z.string().max(150) });
const ChatExecutionSchema = z.object({ version: z.literal(1), kind: z.literal("research_chat"), execution: z.object({ effort: EffortSchema }).strict().optional() });
const AgentExecutionSchema = z.object({ version: z.literal(1), kind: z.literal("agent_task"), execution: z.object({ effort: EffortSchema.optional() }).strict() });

function unavailable(): never { throw new HttpError(404, "NOT_FOUND", "연결 요청을 찾을 수 없어요. 웹에서 다시 연결해주세요."); }
function conflict(): never { throw new HttpError(409, "CONNECTION_CHANGED", "연결 상태가 바뀌었어요. 다시 확인해주세요."); }
function leaseUntil(now: Date, expiresAt: Date): Date { return new Date(Math.min(now.getTime() + LEASE_MS, expiresAt.getTime())); }
function scopeWhere(scope: LocalAgentScope) { return { memberId: scope.memberId, teamId: scope.teamId, sessionKey: scope.sessionKey }; }

async function assertMembership(db: Database, memberId: string, teamId: string): Promise<void> {
  if (!(await db.membership.findUnique({ where: { teamId_memberId: { teamId, memberId } }, select: { memberId: true } }))) {
    throw new HttpError(403, "FORBIDDEN", "이 팀의 연결 권한이 없어요.");
  }
}

function snapshotRows(rows: { provider?: string; payload: Prisma.JsonValue }[], now: Date): LocalAgentProviderSnapshot[] {
  return rows.flatMap(({ provider, payload }) => {
    if (provider === BRIDGE_SNAPSHOT_PROVIDER) return [];
    const parsed = ProviderSnapshotSchema.safeParse(payload);
    if (!parsed.success || new Date(parsed.data.observedAt).getTime() > now.getTime() + 30_000) return [];
    return [sanitizeProviderSnapshot(parsed.data)];
  });
}

async function deviceView(db: Database, device: LocalAgentDevice, grant: LocalAgentGrant | null, now = new Date()): Promise<LocalAgentDeviceView> {
  const authorized = Boolean(grant && !grant.revokedAt && grant.leaseExpiresAt > now && !device.revokedAt);
  const rows = authorized ? await db.localAgentSnapshot.findMany({ where: { deviceId: device.id } }) : [];
  const online = authorized && Boolean(device.lastSeenAt && now.getTime() - device.lastSeenAt.getTime() < BRIDGE_ONLINE_MS);
  const bridge = online ? rows.find((row) => row.provider === BRIDGE_SNAPSHOT_PROVIDER) : undefined;
  const bridgeAge = bridge ? now.getTime() - bridge.observedAt.getTime() : Infinity;
  const metadata = bridge && bridgeAge >= 0 && bridgeAge < BRIDGE_ONLINE_MS ? BridgeSnapshotSchema.safeParse(bridge.payload) : null;
  return {
    id: device.id, name: device.name, platform: device.platform as LocalAgentPlatform,
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    online,
    leaseExpiresAt: grant && !grant.revokedAt ? grant.leaseExpiresAt.toISOString() : null,
    bridgeVersion: metadata?.success ? metadata.data.bridgeVersion : null,
    bridgeArchitecture: metadata?.success ? metadata.data.bridgeArchitecture : null,
    providers: snapshotRows(rows, now),
  };
}

function attemptStatus(attempt: LocalAgentAttempt, now: Date): LocalAgentAttemptView["status"] {
  if (attempt.cancelledAt || attempt.status === "cancelled") return "cancelled";
  if (attempt.status === "connected") return "connected";
  if (attempt.expiresAt <= now || attempt.failedAttempts >= MAX_PAIR_FAILURES) return "expired";
  return attempt.status === "awaiting_code" ? "awaiting_code" : "awaiting_app";
}

async function webAttemptView(db: Database, attempt: LocalAgentAttempt, now = new Date()): Promise<LocalAgentAttemptView> {
  const status = attemptStatus(attempt, now);
  const device = attempt.deviceId ? await db.localAgentDevice.findUnique({ where: { id: attempt.deviceId } }) : null;
  const grant = device ? await db.localAgentGrant.findUnique({ where: { sessionKey_teamId_deviceId: { sessionKey: attempt.sessionKey, teamId: attempt.teamId, deviceId: device.id } } }) : null;
  return { id: attempt.id, version: attempt.version, status, expiresAt: attempt.expiresAt.toISOString(), code: pendingStatuses.includes(status) ? pairingCode(attempt.id) : null, device: device && !device.revokedAt ? await deviceView(db, device, grant, now) : null };
}

export async function getStatus(scope: LocalAgentScope, deviceId?: string): Promise<LocalAgentStatus> {
  await assertMembership(prisma, scope.memberId, scope.teamId);
  const grants = await prisma.localAgentGrant.findMany({ where: { ...scopeWhere(scope), revokedAt: null, device: { revokedAt: null } }, include: { device: true }, orderBy: { updatedAt: "desc" } });
  const devices = await Promise.all(grants.map((grant) => deviceView(prisma, grant.device, grant)));
  return { devices, device: deviceId ? devices.find((row) => row.id === deviceId) ?? null : null, leaseDurationSeconds: LEASE_MS / 1000, heartbeatIntervalSeconds: WEB_HEARTBEAT_SECONDS };
}

export async function createAttempt(scope: LocalAgentScope): Promise<LocalAgentAttemptCreated> {
  const now = new Date();
  await assertMembership(prisma, scope.memberId, scope.teamId);
  const recent = await prisma.localAgentAttempt.count({ where: { memberId: scope.memberId, teamId: scope.teamId, createdAt: { gt: new Date(now.getTime() - 60_000) } } });
  if (recent >= 10) throw new HttpError(429, "TOO_MANY_ATTEMPTS", "연결 요청이 많아요. 잠시 후 다시 눌러주세요.");
  const id = randomUUID();
  const launchToken = randomBytes(32).toString("base64url");
  const code = pairingCode(id);
  const attempt = await prisma.$transaction(async (tx) => {
    await tx.localAgentAttempt.updateMany({ where: { ...scopeWhere(scope), status: { in: pendingStatuses } }, data: { status: "cancelled", cancelledAt: now, version: { increment: 1 } } });
    return tx.localAgentAttempt.create({ data: { id, ...scopeWhere(scope), sessionExpiresAt: scope.sessionExpiresAt, launchTokenHash: hashCredential(launchToken), codeHash: hashCredential(`${id}:${code}`), expiresAt: new Date(Math.min(now.getTime() + ATTEMPT_MS, scope.sessionExpiresAt.getTime())) } });
  });
  const query = new URLSearchParams({ attemptId: id, launchToken });
  return { ...await webAttemptView(prisma, attempt, now), launchToken, deepLink: `hapark-connect://connect?${query}` };
}

export async function getAttempt(scope: LocalAgentScope, id: string): Promise<LocalAgentAttemptView> {
  await assertMembership(prisma, scope.memberId, scope.teamId);
  const attempt = await prisma.localAgentAttempt.findFirst({ where: { id, ...scopeWhere(scope) } });
  if (!attempt) unavailable();
  return webAttemptView(prisma, attempt);
}

export async function cancelAttempt(scope: LocalAgentScope, id: string): Promise<void> {
  await assertMembership(prisma, scope.memberId, scope.teamId);
  const attempt = await prisma.localAgentAttempt.findFirst({ where: { id, ...scopeWhere(scope) } });
  if (!attempt) unavailable();
  await prisma.localAgentAttempt.updateMany({ where: { id, ...scopeWhere(scope), status: { in: pendingStatuses } }, data: { status: "cancelled", cancelledAt: new Date(), version: { increment: 1 } } });
}

async function desktopAttemptView(db: Database, attempt: LocalAgentAttempt, deviceId: string | null, grant: LocalAgentGrant | null): Promise<LocalAgentDesktopAttempt> {
  const [team, member] = await Promise.all([db.team.findUnique({ where: { id: attempt.teamId }, select: { name: true } }), db.member.findUnique({ where: { id: attempt.memberId }, select: { name: true } })]);
  return { attemptId: attempt.id, version: attempt.version, status: deviceId ? "connected" : "awaiting_code", expiresAt: attempt.expiresAt.toISOString(), siteName: "하박조팽", teamName: team?.name ?? "팀", memberName: member?.name ?? "사용자", deviceId, leaseExpiresAt: grant?.leaseExpiresAt.toISOString() ?? null };
}

async function loadDesktopAttempt(db: Database, attemptId: string, launchToken: string, now: Date): Promise<LocalAgentAttempt> {
  const attempt = await db.localAgentAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt || !sameCredential(launchToken, attempt.launchTokenHash)) unavailable();
  if (attempt.cancelledAt || attempt.status === "cancelled" || attempt.expiresAt <= now || attempt.sessionExpiresAt <= now || attempt.failedAttempts >= MAX_PAIR_FAILURES) {
    throw new HttpError(410, "PAIRING_EXPIRED", "연결 요청이 끝났어요. 웹에서 새 번호를 받아주세요.");
  }
  await assertMembership(db, attempt.memberId, attempt.teamId);
  return attempt;
}

async function connectAttempt(db: Database, attempt: LocalAgentAttempt, device: LocalAgentDevice, now: Date): Promise<{ attempt: LocalAgentAttempt; grant: LocalAgentGrant }> {
  const consumed = await db.localAgentAttempt.updateMany({ where: { id: attempt.id, version: attempt.version, consumedAt: null, cancelledAt: null, expiresAt: { gt: now }, status: { in: pendingStatuses }, failedAttempts: { lt: MAX_PAIR_FAILURES } }, data: { consumedAt: now, status: "connected", deviceId: device.id, version: { increment: 1 } } });
  if (consumed.count !== 1) conflict();
  const grant = await db.localAgentGrant.upsert({ where: { sessionKey_teamId_deviceId: { sessionKey: attempt.sessionKey, teamId: attempt.teamId, deviceId: device.id } }, create: { memberId: attempt.memberId, teamId: attempt.teamId, sessionKey: attempt.sessionKey, deviceId: device.id, leaseExpiresAt: leaseUntil(now, attempt.sessionExpiresAt) }, update: { revokedAt: null, leaseExpiresAt: leaseUntil(now, attempt.sessionExpiresAt), version: { increment: 1 } } });
  await db.localAgentDevice.update({ where: { id: device.id }, data: { lastSeenAt: now } });
  return { attempt: { ...attempt, status: "connected", deviceId: device.id, consumedAt: now, version: attempt.version + 1 }, grant };
}

function assertSameDesktop(attempt: LocalAgentAttempt, secretHash: string): void {
  if (attempt.pendingSecretHash && attempt.pendingSecretHash !== secretHash) throw new HttpError(409, "ANOTHER_CONNECTOR", "다른 AI 브릿지가 이 요청을 확인했어요. 웹에서 다시 연결해주세요.");
}

export async function acknowledgeDesktop(input: LocalAgentDesktopAckInput): Promise<LocalAgentDesktopAttempt> {
  if (!validateDeviceToken(input.deviceToken)) throw new HttpError(400, "BAD_REQUEST", "AI 브릿지 정보를 확인해주세요.");
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    let attempt = await loadDesktopAttempt(tx, input.attemptId, input.launchToken, now);
    const secretHash = hashCredential(input.deviceToken);
    assertSameDesktop(attempt, secretHash);
    if (attempt.status === "awaiting_app") {
      const expiresAt = new Date(Math.min(now.getTime() + ATTEMPT_MS, attempt.sessionExpiresAt.getTime()));
      const acked = await tx.localAgentAttempt.updateMany({ where: { id: attempt.id, version: attempt.version, status: "awaiting_app", pendingSecretHash: null, cancelledAt: null, consumedAt: null, expiresAt: { gt: now }, sessionExpiresAt: { gt: now }, failedAttempts: { lt: MAX_PAIR_FAILURES } }, data: { pendingSecretHash: secretHash, pendingName: input.deviceName, pendingPlatform: input.platform, status: "awaiting_code", expiresAt, version: { increment: 1 } } });
      if (acked.count === 1) {
        attempt = { ...attempt, pendingSecretHash: secretHash, pendingName: input.deviceName, pendingPlatform: input.platform, status: "awaiting_code", expiresAt, version: attempt.version + 1 };
      } else {
        // A concurrent ACK may have won. Re-read its fixed deadline and failures;
        // only the same desktop can reuse it, and cancellation/expiry still wins.
        attempt = await loadDesktopAttempt(tx, input.attemptId, input.launchToken, new Date());
        assertSameDesktop(attempt, secretHash);
        if (attempt.status === "awaiting_app") conflict();
      }
    }
    const device = await tx.localAgentDevice.findFirst({ where: { memberId: attempt.memberId, teamId: attempt.teamId, secretHash, revokedAt: null } });
    const grant = device ? await tx.localAgentGrant.findUnique({ where: { sessionKey_teamId_deviceId: { sessionKey: attempt.sessionKey, teamId: attempt.teamId, deviceId: device.id } } }) : null;
    if (attempt.status === "connected") {
      if (!device || attempt.deviceId !== device.id || !grant || grant.revokedAt) unavailable();
      return desktopAttemptView(tx, attempt, device.id, grant);
    }
    if (attempt.status !== "awaiting_code" || attempt.pendingSecretHash !== secretHash) unavailable();
    if (device && grant && !grant.revokedAt) {
      const connected = await connectAttempt(tx, attempt, device, now);
      return desktopAttemptView(tx, connected.attempt, device.id, connected.grant);
    }
    return desktopAttemptView(tx, attempt, null, null);
  });
}

export async function pairDesktop(input: LocalAgentDesktopPairInput): Promise<LocalAgentDesktopAttempt> {
  const result = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const attempt = await loadDesktopAttempt(tx, input.attemptId, input.launchToken, now);
    const secretHash = hashCredential(input.deviceToken);
    if (attempt.pendingSecretHash !== secretHash || !attempt.pendingName || !attempt.pendingPlatform) unavailable();
    if (attempt.consumedAt || attempt.status !== "awaiting_code") throw new HttpError(409, "PAIRING_USED", "이미 확인한 번호예요. 웹에서 연결 상태를 확인해주세요.");
    if (!sameCredential(`${attempt.id}:${input.code}`, attempt.codeHash)) {
      const changed = await tx.localAgentAttempt.updateMany({ where: { id: attempt.id, version: attempt.version, status: "awaiting_code", consumedAt: null, failedAttempts: { lt: MAX_PAIR_FAILURES } }, data: { failedAttempts: { increment: 1 }, version: { increment: 1 } } });
      if (changed.count !== 1) conflict();
      return { invalid: true as const, remaining: MAX_PAIR_FAILURES - attempt.failedAttempts - 1 };
    }
    // Correct code consumes the attempt before registering/re-enabling this device.
    // The same transaction and conditional write prevent parallel pair/cancel/replay.
    const device = await tx.localAgentDevice.upsert({ where: { teamId_memberId_secretHash: { teamId: attempt.teamId, memberId: attempt.memberId, secretHash } }, create: { teamId: attempt.teamId, memberId: attempt.memberId, secretHash, name: attempt.pendingName, platform: attempt.pendingPlatform, lastSeenAt: now }, update: { revokedAt: null, name: attempt.pendingName, platform: attempt.pendingPlatform, lastSeenAt: now } });
    const connected = await connectAttempt(tx, attempt, device, now);
    return { invalid: false as const, view: await desktopAttemptView(tx, connected.attempt, device.id, connected.grant) };
  });
  if (result.invalid) throw new HttpError(result.remaining ? 400 : 410, result.remaining ? "WRONG_CODE" : "PAIRING_EXPIRED", result.remaining ? `번호가 맞지 않아요. 웹의 6자리를 다시 확인해주세요. (${result.remaining}회 남음)` : "번호 확인 횟수를 다 썼어요. 웹에서 새 번호를 받아주세요.");
  return result.view;
}

export async function renewWebPermission(scope: LocalAgentScope, deviceId: string): Promise<{ leaseExpiresAt: string }> {
  await assertMembership(prisma, scope.memberId, scope.teamId);
  const now = new Date();
  const expiry = leaseUntil(now, scope.sessionExpiresAt);
  const updated = await prisma.localAgentGrant.updateMany({ where: { ...scopeWhere(scope), deviceId, revokedAt: null, device: { revokedAt: null } }, data: { leaseExpiresAt: expiry, version: { increment: 1 } } });
  if (!updated.count) throw new HttpError(403, "PAIRING_REQUIRED", "웹과 AI 브릿지를 다시 확인해주세요.");
  return { leaseExpiresAt: expiry.toISOString() };
}

/** Revocation order locks attempts first, preventing an in-flight pairing from creating a fresh grant after logout. */
export async function revokeSession(sessionKey: string, teamId?: string): Promise<void> {
  const where = { sessionKey, ...(teamId ? { teamId } : {}) };
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.localAgentAttempt.updateMany({ where: { ...where, status: { in: [...pendingStatuses, "connected"] } }, data: { cancelledAt: now, status: "cancelled", version: { increment: 1 } } });
    await tx.localAgentGrant.updateMany({ where: { ...where, revokedAt: null }, data: { revokedAt: now, version: { increment: 1 } } });
    await tx.localAgentJob.updateMany({ where: { ...where, status: { in: activeJobStatuses } }, data: { status: "cancelled", error: "웹 연결 권한이 끝났어요.", response: "", version: { increment: 1 } } });
  });
}

/** Called inside the same transaction as membership deletion; a later rejoin needs fresh pairing. */
export async function revokeMembershipConnections(db: Database, scope: { teamId: string; memberId: string }): Promise<void> {
  const now = new Date();
  await db.localAgentAttempt.updateMany({ where: { ...scope, status: { in: [...pendingStatuses, "connected"] } }, data: { cancelledAt: now, status: "cancelled", version: { increment: 1 } } });
  await db.localAgentDevice.updateMany({ where: { ...scope, revokedAt: null }, data: { revokedAt: now } });
  await db.localAgentGrant.updateMany({ where: { ...scope, revokedAt: null }, data: { revokedAt: now, version: { increment: 1 } } });
  await db.localAgentJob.updateMany({ where: { ...scope, status: { in: activeJobStatuses } }, data: { status: "cancelled", response: "", error: "팀 연결 권한이 끝났어요.", version: { increment: 1 } } });
  await db.localAgentSnapshot.deleteMany({ where: scope });
}

export async function revokeDevice(scope: LocalAgentScope, deviceId: string): Promise<void> {
  await assertMembership(prisma, scope.memberId, scope.teamId);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const changed = await tx.localAgentDevice.updateMany({ where: { id: deviceId, memberId: scope.memberId, teamId: scope.teamId, revokedAt: null }, data: { revokedAt: now } });
    if (!changed.count) unavailable();
    await tx.localAgentAttempt.updateMany({ where: { deviceId, status: "connected" }, data: { cancelledAt: now, status: "cancelled", version: { increment: 1 } } });
    await tx.localAgentGrant.updateMany({ where: { deviceId, revokedAt: null }, data: { revokedAt: now, version: { increment: 1 } } });
    await tx.localAgentJob.updateMany({ where: { deviceId, status: { in: activeJobStatuses } }, data: { status: "cancelled", response: "", error: "기기 연결을 해제했어요.", version: { increment: 1 } } });
    await tx.localAgentSnapshot.deleteMany({ where: { deviceId } });
  });
}

async function authenticateDesktop(db: Database, identity: DesktopIdentity): Promise<LocalAgentDevice> {
  const device = await db.localAgentDevice.findUnique({ where: { id: identity.deviceId } });
  if (!device || device.revokedAt || !sameCredential(identity.deviceToken, device.secretHash)) throw new HttpError(401, "DEVICE_UNAUTHORIZED", "AI 브릿지 승인이 필요해요. 웹에서 다시 연결해주세요.");
  await assertMembership(db, device.memberId, device.teamId);
  return device;
}

async function expireDeviceJobs(db: Database, deviceId: string, now: Date): Promise<void> {
  await db.localAgentJob.updateMany({ where: { deviceId, status: { in: activeJobStatuses }, OR: [{ expiresAt: { lte: now } }, { grant: { revokedAt: { not: null } } }, { grant: { leaseExpiresAt: { lte: now } } }] }, data: { status: "cancelled", response: "", error: "연결 권한 또는 작업 시간이 끝났어요.", version: { increment: 1 } } });
}

export async function desktopHeartbeat(identity: DesktopIdentity, providers: LocalAgentProviderSnapshot[], metadata: LocalAgentBridgeMetadata = {}): Promise<LocalAgentDesktopHeartbeat> {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    // Acquire the device row before reading snapshots. PostgreSQL READ COMMITTED
    // otherwise allows two heartbeats to read the same prior row and overwrite
    // a newer logout/catalogue with an older ready result.
    const locked = await tx.localAgentDevice.updateMany({ where: { id: identity.deviceId, secretHash: hashCredential(identity.deviceToken), revokedAt: null }, data: { lastSeenAt: now } });
    if (!locked.count) throw new HttpError(401, "DEVICE_UNAUTHORIZED", "AI 브릿지 승인이 필요해요. 웹에서 다시 연결해주세요.");
    const device = await authenticateDesktop(tx, identity);
    const grant = await tx.localAgentGrant.findFirst({ where: { deviceId: device.id, revokedAt: null, leaseExpiresAt: { gt: now } }, orderBy: { leaseExpiresAt: "desc" } });
    if (!grant) throw new HttpError(403, "WEB_PERMISSION_EXPIRED", "웹에서 AI 연결을 다시 눌러주세요.");
    const parsedMetadata = BridgeMetadataSchema.safeParse(metadata);
    if (!parsedMetadata.success) throw new HttpError(400, "BAD_REQUEST", "요청 내용을 확인해주세요.");
    for (const candidate of providers) {
      const observedAt = new Date(candidate.observedAt);
      if (observedAt.getTime() > now.getTime() + 30_000) throw new HttpError(400, "BAD_SNAPSHOT", "AI 브릿지의 시간을 확인해주세요.");
      const payload = sanitizeProviderSnapshot(candidate);
      const previous = await tx.localAgentSnapshot.findUnique({ where: { deviceId_provider: { deviceId: device.id, provider: payload.provider } } });
      if (previous && previous.observedAt > observedAt) continue;
      await tx.localAgentSnapshot.upsert({ where: { deviceId_provider: { deviceId: device.id, provider: payload.provider } }, create: { deviceId: device.id, teamId: device.teamId, memberId: device.memberId, provider: payload.provider, payload: payload as unknown as Prisma.InputJsonValue, observedAt }, update: { payload: payload as unknown as Prisma.InputJsonValue, observedAt } });
    }
    const bridgePayload = { version: 1, bridgeVersion: parsedMetadata.data.bridgeVersion ?? null, bridgeArchitecture: parsedMetadata.data.bridgeArchitecture ?? null };
    await tx.localAgentSnapshot.upsert({ where: { deviceId_provider: { deviceId: device.id, provider: BRIDGE_SNAPSHOT_PROVIDER } }, create: { deviceId: device.id, teamId: device.teamId, memberId: device.memberId, provider: BRIDGE_SNAPSHOT_PROVIDER, payload: bridgePayload, observedAt: now }, update: { payload: bridgePayload, observedAt: now } });
    // Omitted CLI providers are no longer usable. Keep app metadata even for [].
    await tx.localAgentSnapshot.deleteMany({ where: { deviceId: device.id, provider: { notIn: [BRIDGE_SNAPSHOT_PROVIDER, ...providers.map((row) => row.provider)] } } });
    // Logout/uninstall/limit must also stop that provider's queued/running work;
    // otherwise an unusable first job would block the other provider's queue.
    const stored = snapshotRows(await tx.localAgentSnapshot.findMany({ where: { deviceId: device.id } }), now);
    const ready = stored.filter((row) => row.status === "ready");
    await tx.localAgentJob.updateMany({ where: { deviceId: device.id, status: { in: activeJobStatuses }, provider: { notIn: ready.map((row) => row.provider) } }, data: { status: "cancelled", response: "", error: "연결한 AI의 로그인과 사용 가능 상태를 확인해주세요.", version: { increment: 1 } } });
    for (const provider of ready) {
      await tx.localAgentJob.updateMany({ where: { deviceId: device.id, provider: provider.provider, status: { in: activeJobStatuses }, model: { notIn: provider.models.map((model) => model.id) } }, data: { status: "cancelled", error: "선택한 모델을 더 이상 사용할 수 없어요. 모델을 다시 선택해주세요.", version: { increment: 1 } } });
    }
    await expireDeviceJobs(tx, device.id, now);
    const cancelled = await tx.localAgentJob.findMany({ where: { deviceId: device.id, status: "cancelled", claimedAt: { not: null }, updatedAt: { gt: new Date(now.getTime() - MAX_JOB_MS) } }, select: { id: true }, take: 100 });
    return { leaseExpiresAt: grant.leaseExpiresAt.toISOString(), cancelJobIds: cancelled.map((row) => row.id), heartbeatIntervalSeconds: DESKTOP_HEARTBEAT_SECONDS };
  });
}

function jobView(job: LocalAgentJob): LocalAgentJobView {
  return { id: job.id, version: job.version, paperId: job.paperId, provider: job.provider as LocalAgentProvider, model: job.model, prompt: job.prompt, status: job.status as LocalAgentJobView["status"], response: job.response, error: job.error, createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString() };
}

function claimEffort(job: Pick<LocalAgentJob, "purpose" | "context">): LocalAgentEffort | undefined {
  if (job.purpose !== "chat" && job.purpose !== "agent_step") return undefined;
  try { return (job.purpose === "chat" ? ChatExecutionSchema : AgentExecutionSchema).parse(JSON.parse(job.context)).execution?.effort; }
  catch { throw new HttpError(409, "EFFORT_UNAVAILABLE", "연결 설정에서 사용할 effort를 확인한 뒤 다시 보내주세요."); }
}

async function assertUsableModel(db: Database, deviceId: string, provider: LocalAgentProvider, model: string, now: Date, effort?: LocalAgentEffort): Promise<void> {
  const row = await db.localAgentSnapshot.findUnique({ where: { deviceId_provider: { deviceId, provider } } });
  const parsed = row ? ProviderSnapshotSchema.safeParse(row.payload) : null;
  if (!row || !parsed?.success || now.getTime() - row.observedAt.getTime() > SNAPSHOT_FRESH_MS || parsed.data.status !== "ready" || !parsed.data.models.some((item) => item.id === model)) {
    throw new HttpError(409, "MODEL_UNAVAILABLE", "현재 사용할 수 있는 모델을 다시 선택해주세요.");
  }
  const supported = parsed.data.models.find(item => item.id === model)?.reasoningEfforts;
  if (effort && (!supported || !supported.includes(effort))) throw new HttpError(409, "EFFORT_UNAVAILABLE", "연결 설정에서 이 모델이 지원하는 effort를 선택해주세요.");
}

async function paperContext(db: Database, paperId: string, teamId: string): Promise<string> {
  const paper = await db.paper.findFirst({ where: { id: paperId, teamId }, select: { title: true, authors: true, abstract: true, analyses: { select: { lens: true, payload: true } }, figures: { select: { title: true, caption: true, interpretation: true, sourcePage: true }, take: 30 } } });
  if (!paper) throw new HttpError(404, "PAPER_NOT_FOUND", "이 팀에서 논문을 찾을 수 없어요.");
  // Deliberately no storage key, download URL, filesystem path or caller-supplied context.
  return JSON.stringify({ title: paper.title, authors: paper.authors, abstract: paper.abstract, analyses: paper.analyses, figures: paper.figures }).slice(0, 100_000);
}

interface JobIntent {
  purpose: "question" | "paper_analysis" | "chat" | "agent_step";
  context?: string;
  conversationId?: string;
  conversationTurn?: number;
  initialStatus?: "preparing" | "queued";
  effort?: LocalAgentEffort;
}
export interface PreparedJobOptions {
  purpose: "paper_analysis" | "chat" | "agent_step";
  conversationId?: string;
  conversationTurn?: number;
  initialStatus?: "preparing" | "queued";
  effort?: LocalAgentEffort;
  /** Internal transaction only. Never parsed from a web request. */
  transaction?: Database;
}

function existingRequestView(job: LocalAgentJob, input: LocalAgentJobCreateInput, intent: JobIntent): LocalAgentJobView {
  if (job.deviceId !== input.deviceId || job.paperId !== input.paperId || job.provider !== input.provider || job.model !== input.model || job.prompt !== input.prompt ||
      (job.purpose ?? "question") !== intent.purpose || (job.conversationId ?? null) !== (intent.conversationId ?? null) ||
      (job.conversationTurn ?? null) !== (intent.conversationTurn ?? null) || (intent.context !== undefined && job.context !== intent.context)) throw new HttpError(409, "REQUEST_ID_REUSED", "다른 질문에는 새 요청 번호가 필요해요.");
  return jobView(job);
}

/** Validates execution authority without creating work, presence or a refreshed lease. */
export async function assertAgentCapability(db: Database, deviceId: string, provider: LocalAgentProvider, now = new Date()): Promise<void> {
  const row = await db.localAgentSnapshot.findUnique({ where: { deviceId_provider: { deviceId, provider } } });
  const parsed = ProviderSnapshotSchema.safeParse(row?.payload);
  if (!parsed.success || parsed.data.status !== "ready" || !parsed.data.capabilities?.includes("agent_step_v1") ||
      Math.abs(now.getTime() - Date.parse(parsed.data.observedAt)) > SNAPSHOT_FRESH_MS) {
    throw new HttpError(409, "CONNECTOR_UPDATE_REQUIRED", "논문 작업을 사용하려면 AI 브릿지를 업데이트한 뒤 다시 연결해주세요.");
  }
}

export async function assertJobTarget(scope: LocalAgentScope, input: Pick<LocalAgentJobCreateInput, "deviceId" | "provider" | "model">): Promise<void> {
  await assertMembership(prisma, scope.memberId, scope.teamId);
  const device = await prisma.localAgentDevice.findFirst({ where: { id: input.deviceId, memberId: scope.memberId, teamId: scope.teamId, revokedAt: null } });
  if (!device) throw new HttpError(403, "PAIRING_REQUIRED", "먼저 내 PC를 연결해주세요.");
  const grant = await prisma.localAgentGrant.findFirst({ where: { ...scopeWhere(scope), deviceId: input.deviceId, revokedAt: null } });
  if (!grant) throw new HttpError(403, "PAIRING_REQUIRED", "먼저 내 PC를 연결해주세요.");
  assertGrantUsable(grant);
  await assertUsableModel(prisma, input.deviceId, input.provider, input.model, new Date());
}

export async function createJob(scope: LocalAgentScope, input: LocalAgentJobCreateInput): Promise<LocalAgentJobView> {
  return enqueueJob(scope, input, { purpose: "question" });
}

/** Only server-prepared source text can enter the inference queue through this seam. */
export async function createPreparedJob(scope: LocalAgentScope, input: LocalAgentJobCreateInput, context: string, options: PreparedJobOptions): Promise<LocalAgentJobView> {
  if (!(options.purpose === "chat" ? ChatPreparedSchema : JobCreateSchema).safeParse(input).success || typeof context !== "string" || !context.trim() || context.length > 250_000 ||
      !["paper_analysis", "chat", "agent_step"].includes(options.purpose) ||
      (options.purpose === "chat" ? !options.conversationId || !Number.isInteger(options.conversationTurn) || (options.conversationTurn ?? 0) < 1 : options.conversationId !== undefined || options.conversationTurn !== undefined)) {
    throw new HttpError(400, "BAD_REQUEST", "준비한 논문 문맥과 실행 요청을 확인해주세요.");
  }
  return enqueueJob(scope, input, { purpose: options.purpose, context, conversationId: options.conversationId, conversationTurn: options.conversationTurn, initialStatus: options.initialStatus, effort: options.effort }, options.transaction);
}

async function enqueueJob(scope: LocalAgentScope, input: LocalAgentJobCreateInput, intent: JobIntent, transaction?: Database): Promise<LocalAgentJobView> {
  const admit = async (tx: Database) => {
    // One admission lock per physical device covers request-id deduplication and
    // the device-wide queue cap, even across different active browser grants.
    // A no-op value update acquires the row without pretending the CLI was seen.
    const deviceLock = await tx.localAgentDevice.updateMany({ where: { id: input.deviceId, memberId: scope.memberId, teamId: scope.teamId, revokedAt: null }, data: { revokedAt: null } });
    if (!deviceLock.count) throw new HttpError(403, "PAIRING_REQUIRED", "먼저 내 PC를 연결해주세요.");
    await assertMembership(tx, scope.memberId, scope.teamId);
    const existing = await tx.localAgentJob.findUnique({ where: { teamId_memberId_sessionKey_requestId: { ...scopeWhere(scope), requestId: input.requestId } } });
    if (existing) return existingRequestView(existing, input, intent);
    if (intent.conversationId && !(await tx.researchConversation.findFirst({ where: { id: intent.conversationId, teamId: scope.teamId, memberId: scope.memberId }, select: { id: true } }))) throw new HttpError(404, "NOT_FOUND", "연구 대화를 찾을 수 없어요.");
    const grant = await tx.localAgentGrant.findFirst({ where: { ...scopeWhere(scope), deviceId: input.deviceId, device: { revokedAt: null } } });
    if (!grant) throw new HttpError(403, "PAIRING_REQUIRED", "먼저 내 PC를 연결해주세요.");
    const grantLock = await tx.localAgentGrant.updateMany({ where: { id: grant.id, ...scopeWhere(scope), revokedAt: null, leaseExpiresAt: { gt: new Date() } }, data: { revokedAt: null } });
    if (!grantLock.count) throw new HttpError(403, "WEB_PERMISSION_EXPIRED", "웹 연결 권한이 끝났어요. 웹에서 AI 연결을 다시 눌러주세요.");
    const now = new Date();
    assertGrantUsable(grant, now);
    await assertUsableModel(tx, input.deviceId, input.provider, input.model, now, intent.effort);
    if (intent.purpose === "agent_step") await assertAgentCapability(tx, input.deviceId, input.provider, now);
    const active = await tx.localAgentJob.count({ where: { deviceId: input.deviceId, status: { in: activeJobStatuses } } });
    if (active >= 5) throw new HttpError(429, "QUEUE_FULL", "진행 중인 질문이 많아요. 답변을 받은 뒤 다시 보내주세요.");
    if (intent.context !== undefined && input.paperId && !(await tx.paper.findFirst({ where: { id: input.paperId, teamId: scope.teamId }, select: { id: true } }))) throw new HttpError(404, "PAPER_NOT_FOUND", "이 팀에서 논문을 찾을 수 없어요.");
    const context = intent.context ?? await paperContext(tx, input.paperId, scope.teamId);
    const job = await tx.localAgentJob.create({ data: { ...scopeWhere(scope), deviceId: input.deviceId, grantId: grant.id, paperId: input.paperId, provider: input.provider, model: input.model, prompt: input.prompt, requestId: input.requestId, context, purpose: intent.purpose, status: intent.initialStatus ?? "queued", conversationId: intent.conversationId ?? null, conversationTurn: intent.conversationTurn ?? null, expiresAt: new Date(now.getTime() + MAX_JOB_MS) } });
    return jobView(job);
  };
  // The caller must catch a database conflict only after its outer transaction rolls back.
  if (transaction) return admit(transaction);
  try {
    return await prisma.$transaction(admit);
  } catch (error) {
    // Generated clients/bundles can carry distinct runtime constructors.
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error;
    // Different device rows do not share the admission lock, while request IDs
    // are unique across the whole web session. Read only after PG rolls back
    // the failed transaction, then apply the same idempotency/conflict rule.
    await assertMembership(prisma, scope.memberId, scope.teamId);
    const existing = await prisma.localAgentJob.findUnique({ where: { teamId_memberId_sessionKey_requestId: { ...scopeWhere(scope), requestId: input.requestId } } });
    if (!existing) throw error;
    return existingRequestView(existing, input, intent);
  }
}

export async function getJob(scope: LocalAgentScope, id: string): Promise<LocalAgentJobView> {
  await assertMembership(prisma, scope.memberId, scope.teamId);
  const job = await prisma.localAgentJob.findFirst({ where: { id, ...scopeWhere(scope) } });
  if (!job) throw new HttpError(404, "NOT_FOUND", "질문을 찾을 수 없어요.");
  await expireDeviceJobs(prisma, job.deviceId, new Date());
  const current = await prisma.localAgentJob.findUnique({ where: { id } });
  if (!current) unavailable();
  return jobView(current);
}

export async function cancelJob(scope: LocalAgentScope, id: string): Promise<LocalAgentJobView> {
  await assertMembership(prisma, scope.memberId, scope.teamId);
  const job = await prisma.localAgentJob.findFirst({ where: { id, ...scopeWhere(scope) } });
  if (!job) throw new HttpError(404, "NOT_FOUND", "질문을 찾을 수 없어요.");
  await prisma.localAgentJob.updateMany({ where: { id, ...scopeWhere(scope), status: { in: activeJobStatuses } }, data: { status: "cancelled", error: "질문을 취소했어요.", version: { increment: 1 } } });
  return getJob(scope, id);
}

export async function claimJob(identity: DesktopIdentity): Promise<LocalAgentClaim | null> {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const device = await authenticateDesktop(tx, identity);
    // Serializes claims from duplicate/retried connector processes for this device.
    await tx.localAgentDevice.update({ where: { id: device.id }, data: { lastSeenAt: now } });
    await expireDeviceJobs(tx, device.id, now);
    const validGrant = await tx.localAgentGrant.findFirst({ where: { deviceId: device.id, revokedAt: null, leaseExpiresAt: { gt: now } } });
    if (!validGrant) throw new HttpError(403, "WEB_PERMISSION_EXPIRED", "웹에서 AI 연결을 다시 눌러주세요.");
    if (await tx.localAgentJob.count({ where: { deviceId: device.id, status: "running" } })) return null;
    for (let candidate = 0; candidate < 5; candidate++) {
      const job = await tx.localAgentJob.findFirst({ where: { deviceId: device.id, status: "queued", expiresAt: { gt: now }, grant: { revokedAt: null, leaseExpiresAt: { gt: now } } }, include: { grant: true }, orderBy: { createdAt: "asc" } });
      if (!job) return null;
      assertGrantUsable(job.grant, now);
      try {
        await assertUsableModel(tx, device.id, job.provider as LocalAgentProvider, job.model, now, claimEffort(job));
        if (job.purpose === "agent_step") await assertAgentCapability(tx, device.id, job.provider as LocalAgentProvider, now);
      } catch (error) {
        if (!(error instanceof HttpError) || !["MODEL_UNAVAILABLE", "EFFORT_UNAVAILABLE", "CONNECTOR_UPDATE_REQUIRED"].includes(error.code)) throw error;
        await tx.localAgentJob.updateMany({ where: { id: job.id, status: "queued", version: job.version }, data: { status: "cancelled", error: error.code === "EFFORT_UNAVAILABLE" ? "선택한 effort를 사용할 수 없어요. 연결 설정을 확인한 뒤 다시 보내주세요." : "사용할 수 있는 모델 정보를 다시 확인해주세요.", version: { increment: 1 } } });
        continue;
      }
      const claimToken = randomBytes(32).toString("base64url");
      const claimed = await tx.localAgentJob.updateMany({ where: { id: job.id, status: "queued", version: job.version, grant: { revokedAt: null, leaseExpiresAt: { gt: now } }, device: { revokedAt: null } }, data: { status: "running", claimedAt: now, claimTokenHash: hashCredential(claimToken), version: { increment: 1 } } });
      if (claimed.count !== 1) return null;
      const current = await tx.localAgentJob.findUnique({ where: { id: job.id } });
      if (!current) unavailable();
      return { job: jobView(current), context: current.context, claimToken, leaseExpiresAt: job.grant.leaseExpiresAt.toISOString() };
    }
    return null;
  });
}

export async function submitResult(identity: DesktopIdentity, input: LocalAgentJobResultInput): Promise<{ accepted: true; version: number }> {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const device = await authenticateDesktop(tx, identity);
    const job = await tx.localAgentJob.findFirst({ where: { id: input.jobId, deviceId: device.id, memberId: device.memberId, teamId: device.teamId }, include: { grant: true } });
    if (!job || !job.claimTokenHash || !sameCredential(input.claimToken, job.claimTokenHash)) unavailable();
    assertGrantUsable(job.grant, now);
    if (job.expiresAt <= now || job.status === "cancelled") throw new HttpError(409, "JOB_CANCELLED", "질문이 끝났거나 취소됐어요.");
    if (input.sequence <= job.eventSequence) return { accepted: true, version: job.version };
    if (job.status !== "running") throw new HttpError(409, "JOB_FINISHED", "이미 끝난 질문이에요.");
    const changed = await tx.localAgentJob.updateMany({ where: { id: job.id, status: "running", eventSequence: { lt: input.sequence }, version: job.version, expiresAt: { gt: now }, grant: { revokedAt: null, leaseExpiresAt: { gt: now } }, device: { revokedAt: null } }, data: { eventSequence: input.sequence, status: input.status, response: input.response, error: input.status === "failed" ? input.error ?? "연결한 AI가 답변을 완료하지 못했어요." : null, version: { increment: 1 } } });
    if (changed.count !== 1) conflict();
    return { accepted: true, version: job.version + 1 };
  });
}
