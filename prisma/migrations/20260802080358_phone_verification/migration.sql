-- Additive only: a new table. No existing table, column or index is touched,
-- so this cannot affect data or queries already in use.
CREATE TABLE "PhoneVerification" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PhoneVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PhoneVerification_expiresAt_idx" ON "PhoneVerification"("expiresAt");
