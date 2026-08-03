-- CreateTable
CREATE TABLE "ConversationParticipant" (
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    PRIMARY KEY ("conversationId", "userId"),
    CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConversationParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ConversationParticipant_userId_idx" ON "ConversationParticipant"("userId");


-- Backfill from the comma-joined participantIds, which stays as the uniqueness
-- key. Format is ",uidA,uidB," — sorted, always exactly two for 1:1 threads.
--
-- `a` is the text between the 1st and 2nd comma; `b` is the text between the
-- 2nd and 3rd. The FK filter drops any pair naming a user that no longer
-- exists, which would otherwise fail the constraint and abort the migration.
INSERT INTO "ConversationParticipant" ("conversationId", "userId")
WITH parts AS (
  SELECT
    "id" AS cid,
    "participantIds" AS p,
    substr("participantIds", 2, instr(substr("participantIds", 2), ',') - 1) AS a
  FROM "Conversation"
)
SELECT cid, a FROM parts
WHERE a <> '' AND EXISTS (SELECT 1 FROM "User" WHERE "User"."id" = a)
UNION
SELECT
  cid,
  substr(substr(p, length(a) + 3), 1, instr(substr(p, length(a) + 3), ',') - 1)
FROM parts
WHERE substr(substr(p, length(a) + 3), 1, instr(substr(p, length(a) + 3), ',') - 1) <> ''
  AND EXISTS (
    SELECT 1 FROM "User"
    WHERE "User"."id" =
      substr(substr(p, length(a) + 3), 1, instr(substr(p, length(a) + 3), ',') - 1)
  );
