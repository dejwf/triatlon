-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" UUID;

-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "anonymizedAt" TIMESTAMP(3),
ADD COLUMN     "publicName" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "RaceDirector" (
    "raceId" UUID NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "RaceDirector_pkey" PRIMARY KEY ("raceId","userId")
);

-- AddForeignKey
ALTER TABLE "RaceDirector" ADD CONSTRAINT "RaceDirector_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceDirector" ADD CONSTRAINT "RaceDirector_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
