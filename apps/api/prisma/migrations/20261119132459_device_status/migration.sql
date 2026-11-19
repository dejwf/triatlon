-- CreateTable
CREATE TABLE "DeviceStatus" (
    "raceId" UUID NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "checkpointId" UUID,
    "clockOffsetMs" INTEGER,
    "clockCheckedAt" TIMESTAMPTZ(3),
    "pending" INTEGER NOT NULL DEFAULT 0,
    "oldestPendingAt" TIMESTAMPTZ(3),
    "appVersion" TEXT,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceStatus_pkey" PRIMARY KEY ("raceId","deviceId")
);

-- AddForeignKey
ALTER TABLE "DeviceStatus" ADD CONSTRAINT "DeviceStatus_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceStatus" ADD CONSTRAINT "DeviceStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceStatus" ADD CONSTRAINT "DeviceStatus_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "Checkpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
