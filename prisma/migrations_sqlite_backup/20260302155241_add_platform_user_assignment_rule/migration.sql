-- AlterTable
ALTER TABLE "Session" ADD COLUMN "role" TEXT DEFAULT 'STORE_OWNER';

-- CreateTable
CREATE TABLE "PlatformUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "role" TEXT NOT NULL DEFAULT 'SALES_REP',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "tier" TEXT DEFAULT 'BRONZE',
    "commissionRate" DECIMAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AssignmentRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "conditions" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AbandonedCheckout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "checkoutId" TEXT NOT NULL,
    "cartToken" TEXT,
    "email" TEXT,
    "name" TEXT,
    "totalPrice" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL,
    "checkoutUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ABANDONED',
    "claimedById" TEXT,
    "claimedAt" DATETIME,
    "orderId" TEXT,
    "platformFee" DECIMAL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AbandonedCheckout_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "PlatformUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AbandonedCheckout" ("cartToken", "checkoutId", "checkoutUrl", "claimedAt", "claimedById", "createdAt", "currency", "email", "id", "name", "orderId", "shop", "status", "totalPrice", "updatedAt") SELECT "cartToken", "checkoutId", "checkoutUrl", "claimedAt", "claimedById", "createdAt", "currency", "email", "id", "name", "orderId", "shop", "status", "totalPrice", "updatedAt" FROM "AbandonedCheckout";
DROP TABLE "AbandonedCheckout";
ALTER TABLE "new_AbandonedCheckout" RENAME TO "AbandonedCheckout";
CREATE UNIQUE INDEX "AbandonedCheckout_checkoutId_key" ON "AbandonedCheckout"("checkoutId");
CREATE UNIQUE INDEX "AbandonedCheckout_orderId_key" ON "AbandonedCheckout"("orderId");
CREATE INDEX "AbandonedCheckout_shop_idx" ON "AbandonedCheckout"("shop");
CREATE INDEX "AbandonedCheckout_claimedById_idx" ON "AbandonedCheckout"("claimedById");
CREATE TABLE "new_Commission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "totalAmount" DECIMAL NOT NULL,
    "commissionAmount" DECIMAL NOT NULL,
    "platformFee" DECIMAL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "checkoutId" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Commission_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "AbandonedCheckout" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Commission_repId_fkey" FOREIGN KEY ("repId") REFERENCES "PlatformUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Commission" ("checkoutId", "commissionAmount", "createdAt", "id", "orderId", "orderNumber", "repId", "status", "totalAmount", "updatedAt") SELECT "checkoutId", "commissionAmount", "createdAt", "id", "orderId", "orderNumber", "repId", "status", "totalAmount", "updatedAt" FROM "Commission";
DROP TABLE "Commission";
ALTER TABLE "new_Commission" RENAME TO "Commission";
CREATE UNIQUE INDEX "Commission_orderId_key" ON "Commission"("orderId");
CREATE UNIQUE INDEX "Commission_checkoutId_key" ON "Commission"("checkoutId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PlatformUser_email_key" ON "PlatformUser"("email");
