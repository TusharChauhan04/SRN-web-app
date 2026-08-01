-- Records which tier a pending checkout is for, separately from the tier the
-- user currently holds. Without this the requested tier was discarded, so
-- activation granted whatever was already there (a paid upgrade granted
-- nothing), and marking the live subscription "pending" downgraded an active
-- subscriber the moment they opened the upgrade page.
ALTER TABLE "Subscription" ADD COLUMN "pendingTier" TEXT;

-- One 1:1 thread per participant pair. Without this, two messages sent
-- simultaneously in opposite directions create duplicate conversations that
-- can never be merged. Also replaces a leading-wildcard table scan with an
-- index lookup.
CREATE UNIQUE INDEX "Conversation_participantIds_key" ON "Conversation"("participantIds");
