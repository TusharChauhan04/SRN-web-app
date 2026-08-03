-- CreateTable
CREATE TABLE "SubscriptionOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "razorpayPaymentId" TEXT,
    "settledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubscriptionOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "status" TEXT NOT NULL DEFAULT 'active',
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "razorpaySubscriptionId" TEXT,
    "currentPeriodEnd" DATETIME,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Subscription" ("cancelAtPeriodEnd", "createdAt", "currentPeriodEnd", "id", "razorpayOrderId", "razorpayPaymentId", "razorpaySubscriptionId", "status", "tier", "updatedAt", "userId") SELECT "cancelAtPeriodEnd", "createdAt", "currentPeriodEnd", "id", "razorpayOrderId", "razorpayPaymentId", "razorpaySubscriptionId", "status", "tier", "updatedAt", "userId" FROM "Subscription";
DROP TABLE "Subscription";
ALTER TABLE "new_Subscription" RENAME TO "Subscription";
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "SubscriptionOrder_userId_createdAt_idx" ON "SubscriptionOrder"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionOrder_razorpayPaymentId_idx" ON "SubscriptionOrder"("razorpayPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_requirementId_senderId_key" ON "Quote"("requirementId", "senderId");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

