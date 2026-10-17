-- AlterTable
ALTER TABLE "Paper" ADD COLUMN     "analysisError" TEXT,
ADD COLUMN     "analysisRequestId" TEXT,
ADD COLUMN     "sourceDigest" TEXT,
ADD COLUMN     "sourceText" TEXT;

-- AlterTable
ALTER TABLE "LocalAgentJob" ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "conversationTurn" INTEGER,
ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'question';

-- CreateTable
CREATE TABLE "ResearchConversation" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "paperIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchConversation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchConversation_memberId_teamId_updatedAt_idx" ON "ResearchConversation"("memberId", "teamId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LocalAgentJob_conversationId_conversationTurn_key" ON "LocalAgentJob"("conversationId", "conversationTurn");

-- AddForeignKey
ALTER TABLE "LocalAgentJob" ADD CONSTRAINT "LocalAgentJob_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ResearchConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchConversation" ADD CONSTRAINT "ResearchConversation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
