import { beforeEach, describe, expect, it } from "vitest";
import { repo } from "@/lib/repositories";
import { prisma } from "@/lib/db/client";
import { SYSTEM_ACTOR } from "@/lib/repositories/authorize";
import type { User } from "@/lib/repositories/types";
import { applyVerifiedPayment } from "@/lib/services/subscriptions.service";
import { applyReferralCode } from "@/lib/services/referrals.service";
import { TIER_PRICES_MINOR } from "@/lib/providers/payments/index.server";

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
  await prisma.conversationParticipant.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.dispute.deleteMany();
  await prisma.review.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.quote.deleteMany();
  await prisma.requirement.deleteMany();
  await prisma.verificationRequest.deleteMany();
  await prisma.subscriptionOrder.deleteMany();
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
  /*
   * These go through `applyVerifiedPayment` — the SERVICE — on purpose.
   *
   * An earlier version of this suite called the repository directly and then
   * asserted that the stored row looked right. That asserted nothing: it never
   * replayed a webhook, so deleting the entire order-level guard would have
   * left the suite green. The guards live in the service and in the settle
   * transaction, so the replay has to actually be delivered.
   */
  const ELITE = TIER_PRICES_MINOR.elite;
  const PRO = TIER_PRICES_MINOR.pro;

  it("ignores a replay that carries a NEW payment id for a settled order", async () => {
    const user = await makeUser("payer");
    await repo.subscriptions.createOrder(user.id, "elite", "order_1", ELITE);

    const first = await applyVerifiedPayment({
      orderId: "order_1",
      paymentId: "pay_1",
      amountMinor: ELITE,
    });
    expect(first.applied).toBe(true);

    const afterFirst = await repo.subscriptions.findByUserId(user.id);
    expect(afterFirst?.tier).toBe("elite");
    const periodEndAfterFirst = afterFirst?.currentPeriodEnd?.getTime();
    expect(periodEndAfterFirst).toBeDefined();

    // THE REPLAY: same order, different payment id. This is the delivery that
    // used to grant the tier a second time and extend the paid period for free.
    const replay = await applyVerifiedPayment({
      orderId: "order_1",
      paymentId: "pay_2",
      amountMinor: ELITE,
    });
    expect(replay.applied).toBe(false);
    expect(replay.reason).toBe("order_already_settled");

    const afterReplay = await repo.subscriptions.findByUserId(user.id);
    // The period must NOT have moved. This is the assertion that fails if the
    // order-level guard is removed.
    expect(afterReplay?.currentPeriodEnd?.getTime()).toBe(periodEndAfterFirst);
  });

  it("ignores a provider retry that reuses the same payment id", async () => {
    const user = await makeUser("retried");
    await repo.subscriptions.createOrder(user.id, "pro", "order_retry", PRO);

    await applyVerifiedPayment({
      orderId: "order_retry",
      paymentId: "pay_same",
      amountMinor: PRO,
    });
    const before = await repo.subscriptions.findByUserId(user.id);

    const retry = await applyVerifiedPayment({
      orderId: "order_retry",
      paymentId: "pay_same",
      amountMinor: PRO,
    });
    expect(retry.applied).toBe(false);
    expect(retry.reason).toBe("already_applied");

    const after = await repo.subscriptions.findByUserId(user.id);
    expect(after?.currentPeriodEnd?.getTime()).toBe(
      before?.currentPeriodEnd?.getTime(),
    );
  });

  it("refuses to grant a tier for an order it does not know", async () => {
    const result = await applyVerifiedPayment({
      orderId: "order_never_created",
      paymentId: "pay_x",
      amountMinor: ELITE,
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("unknown_order");
  });

  it("refuses to grant a tier when less was paid than the order was for", async () => {
    const user = await makeUser("underpayer");
    await repo.subscriptions.createOrder(user.id, "elite", "order_cheap", ELITE);

    const result = await applyVerifiedPayment({
      orderId: "order_cheap",
      paymentId: "pay_cheap",
      // Paid the pro price for an elite order.
      amountMinor: PRO,
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("amount_mismatch");

    const subscription = await repo.subscriptions.findByUserId(user.id);
    expect(subscription?.tier ?? "free").toBe("free");
  });

  it("records the tier that was paid for, not the tier already held", async () => {
    // createOrder used to discard its `tier` argument entirely, so activation
    // read back "free" and a paying customer received nothing.
    const user = await makeUser("upgrader");
    await repo.subscriptions.createOrder(user.id, "pro", "order_2", PRO);

    const pending = await repo.subscriptions.findByUserId(user.id);
    // Still free — opening checkout must not grant anything...
    expect(pending?.tier ?? "free").toBe("free");

    await applyVerifiedPayment({
      orderId: "order_2",
      paymentId: "pay_upgrade",
      amountMinor: PRO,
    });

    // ...but the webhook must grant the tier that was actually requested.
    const granted = await repo.subscriptions.findByUserId(user.id);
    expect(granted?.tier).toBe("pro");
  });

  it("does not downgrade a live subscription when checkout is merely opened", async () => {
    const user = await makeUser("subscriber");
    await repo.subscriptions.createOrder(user.id, "pro", "order_3", PRO);
    await applyVerifiedPayment({
      orderId: "order_3",
      paymentId: "pay_3",
      amountMinor: PRO,
    });

    // Opening checkout for a different tier used to flip status to "pending",
    // silently revoking an active subscriber's entitlement mid-period.
    await repo.subscriptions.createOrder(user.id, "elite", "order_4", ELITE);

    const current = await repo.subscriptions.findByUserId(user.id);
    expect(current?.tier).toBe("pro");
    expect(current?.status).toBe("active");
  });

  it("can still settle an ABANDONED order after a newer one was opened", async () => {
    /*
     * Orders used to be upserted onto the subscription row by userId, so
     * opening a second checkout overwrote the first order id. A customer who
     * completed the still-open FIRST payment window was charged for a tier the
     * database no longer had any record of — the webhook resolved nothing, and
     * the money was taken with nothing granted.
     */
    const user = await makeUser("two-tabs");
    await repo.subscriptions.createOrder(user.id, "elite", "order_first", ELITE);
    await repo.subscriptions.createOrder(user.id, "pro", "order_second", PRO);

    const result = await applyVerifiedPayment({
      orderId: "order_first",
      paymentId: "pay_first",
      amountMinor: ELITE,
    });

    expect(result.applied).toBe(true);
    const subscription = await repo.subscriptions.findByUserId(user.id);
    // And they get the tier THAT order was for, not the newer one.
    expect(subscription?.tier).toBe("elite");
  });

  it("grants only once when two deliveries settle the same order at once", async () => {
    const user = await makeUser("concurrent");
    await repo.subscriptions.createOrder(user.id, "elite", "order_race", ELITE);

    const [a, b] = await Promise.all([
      applyVerifiedPayment({
        orderId: "order_race",
        paymentId: "pay_a",
        amountMinor: ELITE,
      }),
      applyVerifiedPayment({
        orderId: "order_race",
        paymentId: "pay_b",
        amountMinor: ELITE,
      }),
    ]);

    // Exactly one wins; the loser reports a decided outcome, not a crash.
    expect([a.applied, b.applied].filter(Boolean)).toHaveLength(1);
    const loser = a.applied ? b : a;
    expect(loser.reason).toBe("order_already_settled");
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

    await expect(applyReferralCode({ id: a.id } as User, codeA)).rejects.toThrow(
      /own referral code/i,
    );

    await applyReferralCode({ id: b.id } as User, codeA);
    const creditedA = await repo.referrals.stats(a.id);
    expect(creditedA.signupCount).toBe(1);

    await expect(applyReferralCode({ id: b.id } as User, codeA)).rejects.toThrow(
      /already applied a referral code/i,
    );

    // Two throwaway accounts must not be able to mint points off each other.
    await expect(applyReferralCode({ id: a.id } as User, codeB)).rejects.toThrow(
      /you referred this person/i,
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
    // `privileges` was never a field on this type, so asserting its absence
      // proved nothing. Assert the property that actually matters: the public
      // projection must not carry contact details.
      expect(found).not.toHaveProperty("email");
      expect(found).not.toHaveProperty("phone");
      expect(found).not.toHaveProperty("fcmToken");
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

describe("conversation participants", () => {
  /**
   * `listConversations` reads the join table, not the comma-joined string, so a
   * conversation created without participant rows would be INVISIBLE to both
   * people in it — with no error anywhere. That is the failure this pins.
   */
  it("writes participant rows whenever a thread is opened", async () => {
    const a = await makeUser("cp-a");
    const b = await makeUser("cp-b", "customer");

    const { conversation } = await repo.messages.send({
      senderId: a.id,
      receiverId: b.id,
      text: "first",
    });

    const rows = await prisma.conversationParticipant.findMany({
      where: { conversationId: conversation.id },
    });
    expect(rows.map((r) => r.userId).sort()).toEqual([a.id, b.id].sort());

    // And both sides can actually find it.
    for (const user of [a, b]) {
      const page = await repo.messages.listConversations(user.id);
      expect(page.items.map((c) => c.id)).toContain(conversation.id);
    }
  });

  it("does not leak a thread to someone who is not in it", async () => {
    const a = await makeUser("cp-x");
    const b = await makeUser("cp-y", "customer");
    const outsider = await makeUser("cp-z", "business");

    await repo.messages.send({ senderId: a.id, receiverId: b.id, text: "hi" });

    const page = await repo.messages.listConversations(outsider.id);
    expect(page.items).toHaveLength(0);
    expect(page.total).toBe(0);
  });
});

describe("participantIds and participant rows must agree", () => {
  /**
   * The same fact is held twice: `participantIds` (the comma-joined uniqueness
   * key, which stops duplicate threads) and the ConversationParticipant rows
   * (which serve lookups). Both are written in ONE place — but nothing enforces
   * that pairing.
   *
   * If they ever diverge the symptom is silent and one-sided: listConversations
   * reads the join table and returns nothing, while findConversationBetween
   * reads the string and still finds the thread. A conversation that exists and
   * is invisible, for one user, with no error anywhere. This makes that a
   * failing test instead.
   */
  it("keeps participantIds and the participant rows in agreement", async () => {
    const a = await makeUser("agree-a");
    const b = await makeUser("agree-b", "customer");
    const c = await makeUser("agree-c", "business");

    await repo.messages.send({ senderId: a.id, receiverId: b.id, text: "1" });
    await repo.messages.send({ senderId: c.id, receiverId: a.id, text: "2" });

    const conversations = await prisma.conversation.findMany({
      include: { participants: true },
    });
    expect(conversations.length).toBeGreaterThan(0);

    for (const conversation of conversations) {
      const fromString = conversation.participantIds
        .split(",")
        .filter(Boolean)
        .sort();
      const fromRows = conversation.participants.map((p) => p.userId).sort();
      expect(fromRows, `conversation ${conversation.id}`).toEqual(fromString);
    }
  });
});

/*
 * Rate limiting had NO tests before the Postgres migration, on either engine.
 *
 * That is worth stating plainly, because the code it guards is security
 * relevant and its own comment describes a real bug it was written to fix: a
 * read-then-branch version returned a hardcoded `allowed: true` whenever the
 * window had expired, so every concurrent request at rollover passed. An
 * attacker could burst, wait one window, and burst again without limit.
 *
 * The fix — a single atomic upsert deriving `allowed` from the count the
 * database actually wrote — was never exercised. These tests exercise it, and
 * would additionally have caught the migration bug on the first run: the query
 * bound datetimes as unix-ms integers, which Postgres rejects outright.
 */
describe("rate limiting", () => {
  it("counts hits and refuses past the limit", async () => {
    const key = `test:basic:${Date.now()}`;

    const first = await repo.rateLimit.hit(key, 3, 60_000);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);

    await repo.rateLimit.hit(key, 3, 60_000);
    const third = await repo.rateLimit.hit(key, 3, 60_000);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const fourth = await repo.rateLimit.hit(key, 3, 60_000);
    expect(fourth.allowed).toBe(false);
  });

  it("returns a valid resetAt", async () => {
    // The SQLite version read the timestamp back with Number(), which yields
    // NaN on a Date — an Invalid Date that no caller would notice until a
    // Retry-After header came out as "Invalid Date".
    const before = Date.now();
    const { resetAt } = await repo.rateLimit.hit(
      `test:reset:${Date.now()}`,
      5,
      60_000,
    );

    expect(Number.isNaN(resetAt.getTime())).toBe(false);
    expect(resetAt.getTime()).toBeGreaterThan(before);
  });

  it("counts every concurrent hit — the rollover burst cannot over-grant", async () => {
    // THE security property. Ten simultaneous requests against a limit of five
    // must allow exactly five. A non-atomic implementation lets all ten read
    // the same pre-increment count and pass together.
    const key = `test:concurrent:${Date.now()}`;

    const results = await Promise.all(
      Array.from({ length: 10 }, () => repo.rateLimit.hit(key, 5, 60_000)),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });

  it("starts a fresh window once the previous one expires", async () => {
    const key = `test:rollover:${Date.now()}`;
    const shortWindow = 50;

    /*
     * No assertion about being blocked BETWEEN these two calls.
     *
     * The first version of this test opened a 1ms window and expected the very
     * next hit to be refused. It failed — correctly. Every call here is a
     * network round trip to a hosted database, so 1ms had long expired before
     * the second one arrived and the limiter rightly rolled the window over.
     * The assertion assumed the code could outrun the wire, which was only ever
     * true against a local SQLite file.
     *
     * Refusal within a window is covered by the first test in this block, which
     * uses a 60s window and does not race anything.
     */
    const first = await repo.rateLimit.hit(key, 1, shortWindow);
    expect(first.allowed).toBe(true);

    await new Promise((r) => setTimeout(r, shortWindow + 100));

    // Past the window: the count must RESET to 1, not keep climbing from the
    // previous window — that reset is the whole point of the CASE expression.
    const afterExpiry = await repo.rateLimit.hit(key, 1, 60_000);
    expect(afterExpiry.allowed).toBe(true);
    expect(afterExpiry.remaining).toBe(0);
  });
});
