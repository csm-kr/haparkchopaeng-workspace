-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 8,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "initial" TEXT NOT NULL,
    "presence" TEXT NOT NULL DEFAULT 'offline',
    "status" TEXT,
    "availability" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "invitedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Paper" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "authors" TEXT NOT NULL,
    "venue" TEXT,
    "year" INTEGER,
    "arxiv" TEXT,
    "pageCount" INTEGER,
    "abstract" TEXT,
    "pdfUrl" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tags" JSONB NOT NULL,
    "analysisStatus" TEXT NOT NULL DEFAULT 'pending'
);

-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paperId" TEXT NOT NULL,
    "lens" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    CONSTRAINT "Analysis_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Figure" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paperId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "interpretation" TEXT NOT NULL,
    "sourcePage" INTEGER NOT NULL,
    "imageUrl" TEXT,
    CONSTRAINT "Figure_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SectionNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paperId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "lens" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SectionNote_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Presentation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "presenterId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "duration" TEXT,
    "slideCount" INTEGER NOT NULL DEFAULT 0,
    "tags" JSONB NOT NULL,
    "summary" TEXT,
    "keypoints" JSONB NOT NULL,
    "slides" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "PresentationAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "presentationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    CONSTRAINT "PresentationAsset_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "Presentation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PresentationVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "presentationId" TEXT NOT NULL,
    "ver" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PresentationVersion_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "Presentation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "presentationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "slide" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Comment_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "Presentation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Reaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "commentId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    CONSTRAINT "Reaction_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScheduleMonth" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "day" TEXT NOT NULL DEFAULT '토요일',
    "saved" BOOLEAN NOT NULL DEFAULT false,
    "rotationPointerAfter" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "ScheduleWeek" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monthId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "presenterId" TEXT,
    "topic" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'upcoming',
    "presentationId" TEXT,
    CONSTRAINT "ScheduleWeek_monthId_fkey" FOREIGN KEY ("monthId") REFERENCES "ScheduleMonth" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FineConfig" (
    "year" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "finePresenter" INTEGER NOT NULL DEFAULT 30000,
    "fineAbsent" INTEGER NOT NULL DEFAULT 10000
);

-- CreateTable
CREATE TABLE "MemberLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "memberId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "missedPresenter" INTEGER NOT NULL DEFAULT 0,
    "missedAbsent" INTEGER NOT NULL DEFAULT 0,
    "paid" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MemberLedger_year_fkey" FOREIGN KEY ("year") REFERENCES "FineConfig" ("year") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LiveSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "presenterId" TEXT NOT NULL,
    "cloudflareLiveInputId" TEXT,
    "recordingUrl" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "liveSessionId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" DATETIME,
    CONSTRAINT "Participant_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "LiveSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "runAfter" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Member_handle_key" ON "Member"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "Member_email_key" ON "Member"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Analysis_paperId_lens_key" ON "Analysis"("paperId", "lens");

-- CreateIndex
CREATE INDEX "SectionNote_paperId_sectionId_lens_idx" ON "SectionNote"("paperId", "sectionId", "lens");

-- CreateIndex
CREATE UNIQUE INDEX "Reaction_commentId_memberId_emoji_key" ON "Reaction"("commentId", "memberId", "emoji");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleMonth_year_month_key" ON "ScheduleMonth"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "MemberLedger_year_memberId_key" ON "MemberLedger"("year", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_liveSessionId_memberId_key" ON "Participant"("liveSessionId", "memberId");

-- CreateIndex
CREATE INDEX "Job_status_runAfter_idx" ON "Job"("status", "runAfter");
