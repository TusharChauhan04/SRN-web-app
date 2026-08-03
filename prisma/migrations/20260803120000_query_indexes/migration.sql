-- DropIndex
DROP INDEX "Quote_requirementId_idx";

-- CreateIndex
CREATE INDEX "Booking_customerId_createdAt_idx" ON "Booking"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_providerId_createdAt_idx" ON "Booking"("providerId", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_createdAt_idx" ON "Booking"("createdAt");

-- CreateIndex
CREATE INDEX "Message_receiverId_read_isDeleted_idx" ON "Message"("receiverId", "read", "isDeleted");

-- CreateIndex
CREATE INDEX "Message_senderId_idx" ON "Message"("senderId");

-- CreateIndex
CREATE INDEX "Quote_senderId_createdAt_idx" ON "Quote"("senderId", "createdAt");

-- CreateIndex
CREATE INDEX "Quote_receiverId_createdAt_idx" ON "Quote"("receiverId", "createdAt");

-- CreateIndex
CREATE INDEX "Requirement_status_createdAt_idx" ON "Requirement"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Requirement_createdAt_idx" ON "Requirement"("createdAt");

-- CreateIndex
CREATE INDEX "Review_authorId_idx" ON "Review"("authorId");

-- CreateIndex
CREATE INDEX "Review_isFlagged_createdAt_idx" ON "Review"("isFlagged", "createdAt");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
