-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('super_admin', 'admin', 'organizer');

-- CreateEnum
CREATE TYPE "RaceStatus" AS ENUM ('planned', 'running', 'finished');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female');

-- CreateEnum
CREATE TYPE "Locality" AS ENUM ('local', 'guest');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('registered', 'checked_in', 'absent', 'disqualified');

-- CreateEnum
CREATE TYPE "RegistrationSource" AS ENUM ('manual', 'import', 'online', 'on_site');

-- CreateEnum
CREATE TYPE "CheckpointKind" AS ENUM ('transition', 'intermediate');

-- CreateEnum
CREATE TYPE "TimeEventType" AS ENUM ('record', 'cancel', 'note', 'admin_correction');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'organizer',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshHash" TEXT NOT NULL,
    "deviceId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Race" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "status" "RaceStatus" NOT NULL DEFAULT 'planned',
    "ageGroups" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Race_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "raceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ageGroupLabel" TEXT NOT NULL,
    "birthYearFrom" INTEGER,
    "birthYearTo" INTEGER NOT NULL,
    "gender" "Gender" NOT NULL,
    "locality" "Locality" NOT NULL,
    "distances" JSONB,
    "startedAt" TIMESTAMP(3),

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discipline" (
    "id" UUID NOT NULL,
    "raceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "Discipline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Checkpoint" (
    "id" UUID NOT NULL,
    "raceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "CheckpointKind" NOT NULL DEFAULT 'transition',
    "disciplineId" UUID,

    CONSTRAINT "Checkpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryCheckpoint" (
    "categoryId" UUID NOT NULL,
    "checkpointId" UUID NOT NULL,
    "distanceM" INTEGER,

    CONSTRAINT "CategoryCheckpoint_pkey" PRIMARY KEY ("categoryId","checkpointId")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" UUID NOT NULL,
    "raceId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "bib" INTEGER NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "birthYear" INTEGER NOT NULL,
    "gender" "Gender" NOT NULL,
    "locality" "Locality" NOT NULL,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'registered',
    "registrationSource" "RegistrationSource" NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "raceId" UUID NOT NULL,
    "checkpointId" UUID NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEvent" (
    "id" UUID NOT NULL,
    "type" "TimeEventType" NOT NULL,
    "participantId" UUID NOT NULL,
    "checkpointId" UUID NOT NULL,
    "ts" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "refEventId" UUID,
    "reason" TEXT,
    "userId" UUID NOT NULL,
    "deviceId" TEXT NOT NULL,
    "serverReceivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingOverride" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "participantIds" UUID[],
    "reason" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "RankingOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "LoginToken_tokenHash_key" ON "LoginToken"("tokenHash");

-- CreateIndex
CREATE INDEX "LoginToken_userId_idx" ON "LoginToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshHash_key" ON "Session"("refreshHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Race_name_year_key" ON "Race"("name", "year");

-- CreateIndex
CREATE INDEX "Category_raceId_idx" ON "Category"("raceId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_raceId_ageGroupLabel_gender_locality_key" ON "Category"("raceId", "ageGroupLabel", "gender", "locality");

-- CreateIndex
CREATE UNIQUE INDEX "Discipline_raceId_seq_key" ON "Discipline"("raceId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Checkpoint_raceId_seq_key" ON "Checkpoint"("raceId", "seq");

-- CreateIndex
CREATE INDEX "Participant_raceId_idx" ON "Participant"("raceId");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_categoryId_bib_key" ON "Participant"("categoryId", "bib");

-- CreateIndex
CREATE INDEX "Assignment_raceId_idx" ON "Assignment"("raceId");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_userId_checkpointId_key" ON "Assignment"("userId", "checkpointId");

-- CreateIndex
CREATE INDEX "TimeEvent_participantId_checkpointId_idx" ON "TimeEvent"("participantId", "checkpointId");

-- CreateIndex
CREATE INDEX "TimeEvent_checkpointId_idx" ON "TimeEvent"("checkpointId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- AddForeignKey
ALTER TABLE "LoginToken" ADD CONSTRAINT "LoginToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discipline" ADD CONSTRAINT "Discipline_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkpoint" ADD CONSTRAINT "Checkpoint_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkpoint" ADD CONSTRAINT "Checkpoint_disciplineId_fkey" FOREIGN KEY ("disciplineId") REFERENCES "Discipline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryCheckpoint" ADD CONSTRAINT "CategoryCheckpoint_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryCheckpoint" ADD CONSTRAINT "CategoryCheckpoint_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "Checkpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "Checkpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEvent" ADD CONSTRAINT "TimeEvent_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEvent" ADD CONSTRAINT "TimeEvent_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "Checkpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEvent" ADD CONSTRAINT "TimeEvent_refEventId_fkey" FOREIGN KEY ("refEventId") REFERENCES "TimeEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEvent" ADD CONSTRAINT "TimeEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingOverride" ADD CONSTRAINT "RankingOverride_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
