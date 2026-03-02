-- AlterTable
ALTER TABLE "AbandonedCheckout" ADD COLUMN "lastContactedAt" DATETIME;

-- CreateTable
CREATE TABLE "Communication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "checkoutId" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "content" TEXT,
    "qcScore" REAL,
    "qcFeedback" TEXT,
    "sentiment" TEXT,
    "customerRating" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Communication_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "AbandonedCheckout" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Communication_repId_fkey" FOREIGN KEY ("repId") REFERENCES "PlatformUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Communication_checkoutId_idx" ON "Communication"("checkoutId");

-- CreateIndex
CREATE INDEX "Communication_repId_idx" ON "Communication"("repId");
