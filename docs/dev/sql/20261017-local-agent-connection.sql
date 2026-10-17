-- CreateTable
CREATE TABLE "LocalAgentDevice" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocalAgentDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalAgentAttempt" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "sessionExpiresAt" TIMESTAMP(3) NOT NULL,
    "launchTokenHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_app',
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "pendingSecretHash" TEXT,
    "pendingName" TEXT,
    "pendingPlatform" TEXT,
    "deviceId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocalAgentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalAgentGrant" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalAgentGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalAgentSnapshot" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalAgentSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalAgentJob" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "response" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "eventSequence" INTEGER NOT NULL DEFAULT 0,
    "claimTokenHash" TEXT,
    "claimedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalAgentJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LocalAgentDevice_memberId_teamId_idx" ON "LocalAgentDevice"("memberId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "LocalAgentDevice_teamId_memberId_secretHash_key" ON "LocalAgentDevice"("teamId", "memberId", "secretHash");

-- CreateIndex
CREATE INDEX "LocalAgentAttempt_memberId_teamId_sessionKey_idx" ON "LocalAgentAttempt"("memberId", "teamId", "sessionKey");

-- CreateIndex
CREATE INDEX "LocalAgentAttempt_expiresAt_idx" ON "LocalAgentAttempt"("expiresAt");

-- CreateIndex
CREATE INDEX "LocalAgentGrant_deviceId_revokedAt_leaseExpiresAt_idx" ON "LocalAgentGrant"("deviceId", "revokedAt", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LocalAgentGrant_sessionKey_teamId_deviceId_key" ON "LocalAgentGrant"("sessionKey", "teamId", "deviceId");

-- CreateIndex
CREATE INDEX "LocalAgentSnapshot_teamId_memberId_idx" ON "LocalAgentSnapshot"("teamId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "LocalAgentSnapshot_deviceId_provider_key" ON "LocalAgentSnapshot"("deviceId", "provider");

-- CreateIndex
CREATE INDEX "LocalAgentJob_deviceId_status_createdAt_idx" ON "LocalAgentJob"("deviceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "LocalAgentJob_grantId_status_idx" ON "LocalAgentJob"("grantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LocalAgentJob_teamId_memberId_sessionKey_requestId_key" ON "LocalAgentJob"("teamId", "memberId", "sessionKey", "requestId");

-- AddForeignKey
ALTER TABLE "LocalAgentDevice" ADD CONSTRAINT "LocalAgentDevice_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalAgentAttempt" ADD CONSTRAINT "LocalAgentAttempt_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalAgentAttempt" ADD CONSTRAINT "LocalAgentAttempt_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "LocalAgentDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalAgentGrant" ADD CONSTRAINT "LocalAgentGrant_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalAgentGrant" ADD CONSTRAINT "LocalAgentGrant_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "LocalAgentDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalAgentSnapshot" ADD CONSTRAINT "LocalAgentSnapshot_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalAgentSnapshot" ADD CONSTRAINT "LocalAgentSnapshot_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "LocalAgentDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalAgentJob" ADD CONSTRAINT "LocalAgentJob_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalAgentJob" ADD CONSTRAINT "LocalAgentJob_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "LocalAgentDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalAgentJob" ADD CONSTRAINT "LocalAgentJob_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "LocalAgentGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
