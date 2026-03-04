-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ShopSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "commissionRate" DECIMAL NOT NULL DEFAULT 10.0,
    "isMarketplaceEnabled" BOOLEAN NOT NULL DEFAULT true,
    "recoveryTone" TEXT NOT NULL DEFAULT 'FRIENDLY',
    "customInstructions" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ShopSettings" ("commissionRate", "createdAt", "id", "isMarketplaceEnabled", "shop", "updatedAt") SELECT "commissionRate", "createdAt", "id", "isMarketplaceEnabled", "shop", "updatedAt" FROM "ShopSettings";
DROP TABLE "ShopSettings";
ALTER TABLE "new_ShopSettings" RENAME TO "ShopSettings";
CREATE UNIQUE INDEX "ShopSettings_shop_key" ON "ShopSettings"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
