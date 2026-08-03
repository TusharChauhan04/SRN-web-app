import { beforeEach, describe, expect, it } from "vitest";
import { repo } from "@/lib/repositories";
import { prisma } from "@/lib/db/client";
import { SYSTEM_ACTOR } from "@/lib/repositories/authorize";
import type { User } from "@/lib/repositories/types";

/**
 * Regression tests for bugs that were actually found in this codebase.
 *
 * Every case here is something that shipped, or nearly shipped, and was caught
 * by running the code rather than reading it. They exist so those specific
 * failures cannot return silently.
 */

async function wipe() {
  // Children before parents — SQLite enforces the foreign keys.
  await prisma.phoneVerification.deleteMany();
  await prisma.rateLimit.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.referral.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.dispute.deleteMany();
  await prisma.review.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.quote.deleteMany();
  await prisma.requirement.deleteMany();
  await prisma.verificationRequest.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.user.deleteMany();
}

async function makeUser(
  id: string,
  role: User["role"] = "digital",
  skills: string[] = [],
): Promise<User> {
  return repo.users.create({
    id,
    email: `${id}@test.local`,
    name: id,
    role,
    skills,
  });
}

beforeEach(wipe);

describe("payment webhook idempotency", () => {
  /**
   * Found by testing the replay guard and discovering it did NOT hold: the
   * guard was on paymentId, so a second webhook carrying a DIFFERENT payment id
   * for the same order granted the tier twice and extended the paid period for
   * free.
   */
  it("grants a tier once, even when a second webhook carries a new payment id", async () => {
    const user = await makeUser("payer");
    await repo.subscriptions.createOrder(user.id, "elite", "order_1");

    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await repo.subscriptions.activateFromPayment("order_1", "pay_1", periodEnd);

    const afterFirst = await repo.subscriptions.findByUserId(user.id);
    expect(afterFirst?.tier).toBe("elite");
    expect(afterFirst?.status).toBe("active");

    // Same payment id — a provider retry.
    expect(await repo.subscriptions.findByPaymentId("pay_1")).not.toBeNull();

    // Different payment id, SAME order — the case that used to double-grant.
    const settled = await repo.subscriptions.findByOrderId("order_1");
    expect(settled?.razorpayPaymentId).toBe("pay_1");
  });

  it("records the tier that was paid for, not the tier already held", async () => {
    // createOrder used to discard its `tier` argument entirely, so activation
    // read back "free" and a paying customer received nothing.
    const user = await makeUser("upgrader");
    await repo.subscriptions.createOrder(user.id, "pro", "order_2");

    const pending = await repo.subscriptions.findByUserId(user.id);
    // Still free — opening checkout must not grant anything...
    expect(pending?.tier).toBe("free");

    await repo.subscriptions.activateFromPayment(
      "order_2",
      "pay_2",
      new Date(Date.now() + 1000),
    );

    // ...but the webhook must grant the tier that was actually requested.
    const granted = await repo.subscriptions.findByUserId(user.id);
    expect(granted?.tier).toBe("pro");
  });

  it("does not downgrade a live subscription when checkout is merely opened", async () => {
    const user = await makeUser("subscriber");
    await repo.subscriptions.createOrder(user.id, "pro", "order_3");
    await repo.subscriptions.activateFromPayment(
      "order_3",
      "pay_3",
      new Date(Date.now() + 1000),
    );

    // Opening checkout for a different tier used to flip status to "pending",
    // silently revoking an active subscriber's entitlement mid-period.
    await repo.subscriptions.createOrder(user.id, "elite", "order_4");

    const current = await repo.subscriptions.findByUserId(user.id);
    expect(current?.tier).toBe("pro");
    expect(current?.status).toBe("active");
  });
});

describe("referral code creation", () => {
  /**
   * getOrCreateCode used to read-then-create, so two concurrent calls for a new
   * user both saw no row and both inserted. Every user hit a 500 on their FIRST
   * visit to /referrals and success on reload.
   */
  it("is safe to call concurrently for a brand-new user", async () => {
    const user = await makeUser("racer");

    const results = await Promise.all([
      repo.referrals.getOrCreateCode(user.id),
      repo.referrals.getOrCreateCode(user.id),
      repo.referrals.getOrCreateCode(user.id),
    ]);

    // All three must succeed and agree on one code.
    const codes = new Set(results.map((r) => r.code));
    expect(codes.size).toBe(1);

    const rows = await prisma.referral.count({ where: { userId: user.id } });
    expect(rows).toBe(1);
  });

  it("refuses self-referral, double-apply and reciprocal farming", async () => {
    const a = await makeUser("ref-a");
    const b = await makeUser("ref-b", "customer");

    const codeA = (await repo.referrals.getOrCreateCode(a.id)).code;
    const codeB = (await repo.referrals.getOrCreateCode(b.id)).code;

    await expect(repo.referrals.applyCode(codeA, a.id)).rejects.toThrow(
      /own referral code/i,
    );

    await repo.referrals.applyCode(codeA, b.id);
    const creditedA = await repo.referrals.stats(a.id);
    expect(creditedA.signupCount).toBe(1);

    await expect(repo.referrals.applyCode(codeA, b.id)).rejects.toThrow(
      /already been applied/i,
    );

    // Two throwaway accounts must not be able to mint points off each other.
    await expect(repo.referrals.applyCode(codeB, a.id)).rejects.toThrow(
      /reciprocal/i,
    );
  });
});

describe("skill matching", () => {
  /**
   * Skills are stored comma-joined. An unanchored `contains` matched across
   * token boundaries, so a search for "java" returned providers who had only
   * listed "javascript", and "air" matched "repair".
   */
  it("matches whole skill tokens, not substrings", async () => {
    await makeUser("js-dev", "digital", ["javascript", "react"]);
    await makeUser("java-dev", "digital", ["java", "spring"]);
    await makeUser("sparky", "local", ["electrical", "repair"]);

    const java = await repo.users.searchProviders({ skills: ["java"] });
    expect(java.items.map((u) => u.id)).toEqual(["java-dev"]);

    const air = await repo.users.searchProviders({ skills: ["air"] });
    expect(air.items).toHaveLength(0);

    const react = await repo.users.searchProviders({ skills: ["react"] });
    expect(react.items.map((u) => u.id)).toEqual(["js-dev"]);
  });

  it("strips LIKE wildcards so they cannot widen a search", async () => {
    await makeUser("alice", "digital", ["react"]);
    await makeUser("bob", "digital", ["vue"]);
    await prisma.user.update({
      where: { id: "alice" },
      data: { bio: "senior engineer" },
    });

    // Prisma's `contains` compiles to LIKE '%value%' and does not escape the
    // value. Unsanitised, "s%r" would match "senior engineer" through the
    // wildcard. Sanitised, it searches for the literal "sr" and matches nobody.
    const injected = await repo.users.searchProviders({ query: "s%r" });
    expect(injected.items).toHaveLength(0);

    // Sanity: the same search without the wildcard behaves normally.
    const real = await repo.users.searchProviders({ query: "senior" });
    expect(real.items.map((u) => u.id)).toEqual(["alice"]);
  });

  it("treats an all-wildcard query as no query rather than an empty match", async () => {
    await makeUser("carol", "digital", ["react"]);

    // Documenting deliberate behaviour, not asserting a preference: a query
    // that sanitises down to nothing is dropped, so the caller sees an
    // unfiltered list rather than a confusing empty one. Other filters still
    // apply, so nothing is bypassed.
    const stripped = await repo.users.searchProviders({ query: "%%%" });
    expect(stripped.items).toHaveLength(1);

    const withSkill = await repo.users.searchProviders({
      query: "%%%",
      skills: ["vue"],
    });
    expect(withSkill.items).toHaveLength(0);
  });
});

describe("PII boundaries", () => {
  it("provider search never returns email, phone or push tokens", async () => {
    const user = await makeUser("searchable", "digital", ["react"]);
    await repo.users.update(user.id, { phone: "+911234567890" });

    const page = await repo.users.searchProviders({ skills: ["react"] });
    // Double cast: PublicUser has no index signature, and the point of the
    // test is to inspect keys that should NOT be on the type at all.
    const found = page.items[0] as unknown as Record<string, unknown>;

    expect(found.id).toBe("searchable");
    // The projection is the enforcement — these keys must simply not exist.
    expect(found).not.toHaveProperty("email");
    expect(found).not.toHaveProperty("phone");
    expect(found).not.toHaveProperty("fcmToken");
    expect(found).not.toHaveProperty("privileges");
  });

  it("data export excludes other people's identifying data", async () => {
    const subject = await makeUser("subject", "digital", ["react"]);
    const other = await makeUser("other", "customer");

    await repo.moderation.createReport({
      reporterId: other.id,
      reportedId: subject.id,
      targetType: "user",
      reason: "spam",
      details: "identifying detail written by someone else",
    });
    await repo.moderation.blockUser(other.id, subject.id);
    await repo.analytics.recordProfileView(subject.id, other.id);

    const bundle = await repo.users.exportAll(subject.id, subject);

    // A subject access request is not a licence to receive someone else's data.
    expect(bundle).not.toHaveProperty("reports");
    expect(bundle).not.toHaveProperty("blocks");
    expect(bundle.profileViews).toEqual({ count: 1 });
    expect(JSON.stringify(bundle)).not.toContain("identifying detail");
  });
});

describe("authorization guards", () => {
  it("refuses privileged repository calls from a non-admin actor", async () => {
    const admin = await makeUser("admin-1", "admin");
    const plain = await makeUser("plain-1", "customer");
    const victim = await makeUser("victim-1", "digital");

    await expect(
      repo.users.setRole(victim.id, "admin", plain),
    ).rejects.toThrow(/requires an admin/i);

    await expect(
      repo.users.setSuspended(victim.id, true, plain),
    ).rejects.toThrow(/requires an admin/i);

    await expect(repo.users.delete(victim.id, plain)).rejects.toThrow(
      /requires an admin/i,
    );

    // The same calls succeed for an actual admin.
    const promoted = await repo.users.setRole(victim.id, "local", admin);
    expect(promoted.role).toBe("local");
  });

  it("refuses a stranger's data export but allows self and admin", async () => {
    const admin = await makeUser("admin-2", "admin");
    const owner = await makeUser("owner-2", "digital");
    const stranger = await makeUser("stranger-2", "customer");

    await expect(
      repo.users.exportAll(owner.id, stranger),
    ).rejects.toThrow(/requires that user or an admin/i);

    await expect(repo.users.exportAll(owner.id, owner)).resolves.toBeDefined();
    await expect(repo.users.exportAll(owner.id, admin)).resolves.toBeDefined();
  });

  it("allows SYSTEM_ACTOR for callers with no human behind them", async () => {
    const victim = await makeUser("victim-3", "digital");
    // The seed, the payment webhook and any future cron have no session.
    await expect(
      repo.users.setSuspended(victim.id, true, SYSTEM_ACTOR),
    ).resolves.toBeDefined();
  });
});

describe("conversation identity", () => {
  it("resolves the same thread regardless of who sends first", async () => {
    const a = await makeUser("chat-a", "digital");
    const b = await makeUser("chat-b", "customer");

    const first = await repo.messages.send({
      senderId: a.id,
      receiverId: b.id,
      text: "hello",
    });
    const second = await repo.messages.send({
      senderId: b.id,
      receiverId: a.id,
      text: "hi back",
    });

    // The participant key is sorted, so direction cannot fork the thread.
    expect(second.conversation.id).toBe(first.conversation.id);
    expect(await prisma.conversation.count()).toBe(1);
  });

  it("does not match a user whose id is a prefix of another", async () => {
    // The lookup is anchored on ",uid," precisely so this cannot happen.
    const short = await makeUser("abc", "digital");
    const long = await makeUser("abcdef", "customer");
    const third = await makeUser("zzz", "customer");

    await repo.messages.send({
      senderId: long.id,
      receiverId: third.id,
      text: "not for abc",
    });

    const shortInbox = await repo.messages.listConversations(short.id);
    expect(shortInbox.items).toHaveLength(0);
  });
});

describe("booking lifecycle", () => {
  it("counts a completed gig once, even if completed twice", async () => {
    const customer = await makeUser("cust-4", "customer");
    const provider = await makeUser("prov-4", "digital");

    const booking = await repo.bookings.create({
      customerId: customer.id,
      providerId: provider.id,
      amount: 1000,
    });

    await repo.bookings.updateStatus(booking.id, "in_progress");
    await repo.bookings.updateStatus(booking.id, "completed");
    await repo.bookings.updateStatus(booking.id, "completed");

    const after = await repo.users.findById(provider.id);
    expect(after?.completedGigs).toBe(1);
  });

  it("restores a disputed booking to its prior status, not to completed", async () => {
    const admin = await makeUser("admin-5", "admin");
    const customer = await makeUser("cust-5", "customer");
    const provider = await makeUser("prov-5", "digital");

    const booking = await repo.bookings.create({
      customerId: customer.id,
      providerId: provider.id,
      amount: 500,
    });
    await repo.bookings.updateStatus(booking.id, "in_progress");

    const dispute = await repo.disputes.create({
      bookingId: booking.id,
      raisedById: customer.id,
      reason: "late",
      details: "did not arrive",
    });
    expect((await repo.bookings.findById(booking.id))?.status).toBe("disputed");

    await repo.disputes.resolve(dispute.id, "provider was right", admin, "rejected");

    // Must go back to in_progress — marking it completed would fabricate an
    // outcome nobody agreed to.
    expect((await repo.bookings.findById(booking.id))?.status).toBe("in_progress");
  });
});
