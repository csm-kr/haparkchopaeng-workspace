-- AlterTable
ALTER TABLE "Presentation" ADD COLUMN     "sourcePaperId" TEXT;

-- CreateTable
CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "conversationId" TEXT,
    "sessionKey" TEXT NOT NULL,
    "sessionExpiresAt" TIMESTAMP(3) NOT NULL,
    "deviceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "effort" TEXT NOT NULL DEFAULT 'medium',
    "paperId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'note',
    "goal" TEXT NOT NULL,
    "completion" TEXT NOT NULL DEFAULT 'draft',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "phase" TEXT NOT NULL DEFAULT 'queued',
    "version" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "decisionCount" INTEGER NOT NULL DEFAULT 0,
    "toolCount" INTEGER NOT NULL DEFAULT 0,
    "repairCount" INTEGER NOT NULL DEFAULT 0,
    "sourceRevision" TEXT,
    "draft" JSONB,
    "activeJobId" TEXT,
    "error" TEXT,
    "runStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentOperation" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentTask_teamId_memberId_updatedAt_idx" ON "AgentTask"("teamId", "memberId", "updatedAt");

-- CreateIndex
CREATE INDEX "AgentTask_status_updatedAt_idx" ON "AgentTask"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTask_teamId_memberId_requestId_key" ON "AgentTask"("teamId", "memberId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentOperation_jobId_key" ON "AgentOperation"("jobId");

-- CreateIndex
CREATE INDEX "AgentOperation_taskId_createdAt_idx" ON "AgentOperation"("taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentOperation_taskId_revision_key_key" ON "AgentOperation"("taskId", "revision", "key");

-- AddForeignKey
ALTER TABLE "Presentation" ADD CONSTRAINT "Presentation_sourcePaperId_fkey" FOREIGN KEY ("sourcePaperId") REFERENCES "Paper"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentOperation" ADD CONSTRAINT "AgentOperation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
