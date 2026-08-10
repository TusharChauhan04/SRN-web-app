/**
 * Seeds the placeholder database with enough realistic data to exercise every
 * screen. An empty database makes it impossible to tell whether a page works or
 * is silently broken, so this covers all five roles and every major entity.
 *
 * Run with: pnpm db:seed   (destructive — wipes and re-seeds)
 *
 * NOTE: the user ids here are NOT real Firebase uids. Signing in with a real
 * Firebase account creates a separate profile row. To exercise a seeded role
 * end-to-end, either sign in and then update that row's `role`, or set the
 * seeded id to your own Firebase uid. See DATABASE.md.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const daysAhead = (n: number) => new Date(Date.now() + n * DAY);

/**
 * Comma-DELIMITED list column, matching `joinList` in the repository mappers.
 *
 * The surrounding commas are what make token matching exact. Writing a bare
 * "react,nextjs" here would produce seed data the repositories could never
 * have written, and skill search would silently miss every seeded provider.
 */
const list = (...items: string[]) => `,${items.join(",")},`;

/** Participant key, matching `conversationKey` in the mappers. */
const convKeyFor = (a: string, b: string) => `,${[a, b].sort().join(",")},`;

/**
 * Refuses to run anywhere it could destroy real data.
 *
 * This script calls deleteMany() on all 24 tables against whatever
 * DATABASE_URL resolves to, and CI invokes it as a build step. Previously
 * nothing in the script enforced which database that was — CI was safe only
 * because the workflow happened to set a local file URL inline. A deploy
 * pipeline inheriting that step, or a human running `pnpm db:seed` with a
 * production .env loaded, would have wiped the database with no warning.
 */
function assertSafeToWipe(): void {
  const url = process.env.DATABASE_URL ?? "";
  const override = process.env.SEED_ALLOW_DESTRUCTIVE === "1";

  if (override) {
    console.warn(
      "⚠  SEED_ALLOW_DESTRUCTIVE=1 — wiping a non-local database on purpose.",
    );
    return;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to seed: NODE_ENV=production. This script deletes every row in every table.\n" +
        "If you genuinely mean to wipe this database, re-run with SEED_ALLOW_DESTRUCTIVE=1.",
    );
  }

  /*
   * Every database is now remote.
   *
   * This used to allow any `file:` URL through, because a local SQLite file was
   * self-evidently disposable. On Postgres there is no such category: the
   * development database, staging and production are all the same kind of URL,
   * distinguishable only by host and schema — neither of which this script can
   * judge safely. So it refuses by default and makes the operator say so.
   *
   * Yes, that means `pnpm db:seed` now always needs the flag. That is the point:
   * the previous version's safety came from a property of the URL that no
   * longer exists.
   */
  throw new Error(
    `Refusing to seed: this deletes every row in every table, and DATABASE_URL ` +
      `points at a remote database (${url.split("://")[0] || "unset"}://…).\n\n` +
      "Unlike the SQLite era there is no 'obviously local' URL to detect — a dev\n" +
      "database and production look identical from here.\n\n" +
      "If you genuinely mean to wipe THIS database, re-run with " +
      "SEED_ALLOW_DESTRUCTIVE=1.",
  );
}

async function main() {
  assertSafeToWipe();

  console.log("Clearing existing data…");

  // Order matters: children before parents, since SQLite enforces FKs.
  await prisma.rateLimit.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.featureFlag.deleteMany();
  await prisma.profileView.deleteMany();
  await prisma.presence.deleteMany();
  await prisma.referral.deleteMany();
  await prisma.notificationPref.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.upload.deleteMany();
  await prisma.report.deleteMany();
  await prisma.block.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversationParticipant.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.dispute.deleteMany();
  await prisma.review.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.quote.deleteMany();
  await prisma.requirement.deleteMany();
  await prisma.verificationRequest.deleteMany();
  await prisma.portfolioItem.deleteMany();
  await prisma.workingHours.deleteMany();
  await prisma.blockedDate.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.user.deleteMany();

  console.log("Seeding users…");

  const admin = await prisma.user.create({
    data: {
      id: "seed-admin-1",
      email: "admin@srn.test",
      name: "Asha Menon",
      role: "admin",
      privileges: list("users", "disputes", "verification", "flags", "revenue"),
      isVerified: true,
      createdAt: daysAgo(180),
    },
  });

  const business = await prisma.user.create({
    data: {
      id: "seed-business-1",
      email: "ravi@northwind.test",
      name: "Ravi Deshpande",
      role: "business",
      companyName: "Northwind Logistics",
      industry: "Supply Chain",
      location: "Pune, MH",
      bio: "Scaling a mid-size logistics firm. Usually hiring for web, data, and ops tooling.",
      phone: "+919812345601",
      phoneVerified: true,
      isVerified: true,
      createdAt: daysAgo(120),
    },
  });

  const customer = await prisma.user.create({
    data: {
      id: "seed-customer-1",
      email: "meera@example.test",
      name: "Meera Iyer",
      role: "customer",
      location: "Bengaluru, KA",
      bio: "Homeowner. Hire for repairs, tutoring, and the occasional design job.",
      phone: "+919812345602",
      phoneVerified: true,
      createdAt: daysAgo(90),
    },
  });

  const digital = await prisma.user.create({
    data: {
      id: "seed-digital-1",
      email: "arjun@dev.test",
      name: "Arjun Nair",
      role: "digital",
      title: "Full-stack developer",
      skills: list("react", "nextjs", "typescript", "node", "postgres"),
      hourlyRate: 2200,
      location: "Kochi, KL",
      bio: "8 years building web products. React/Next specialist, comfortable owning delivery end to end.",
      phone: "+919812345603",
      phoneVerified: true,
      isVerified: true,
      isPremium: true,
      completedGigs: 34,
      onTimeRate: 0.96,
      rehireCount: 11,
      aiTrustScore: 87,
      createdAt: daysAgo(150),
    },
  });

  const digital2 = await prisma.user.create({
    data: {
      id: "seed-digital-2",
      email: "priya@design.test",
      name: "Priya Sharma",
      role: "digital",
      title: "Product designer",
      skills: list("figma", "ui", "ux", "branding", "webflow"),
      hourlyRate: 1800,
      location: "Remote",
      bio: "Design systems and marketing sites. I work fast and I document what I hand over.",
      isVerified: true,
      completedGigs: 21,
      onTimeRate: 0.91,
      aiTrustScore: 79,
      createdAt: daysAgo(100),
    },
  });

  const local = await prisma.user.create({
    data: {
      id: "seed-local-1",
      email: "suresh@services.test",
      name: "Suresh Kumar",
      role: "local",
      title: "Certified electrician",
      skills: list("electrical", "wiring", "inverter", "repair"),
      hourlyRate: 650,
      serviceRadiusKm: 25,
      location: "Bengaluru, KA",
      bio: "Licensed electrician, 12 years. Same-day callouts within 25km.",
      phone: "+919812345604",
      phoneVerified: true,
      isVerified: true,
      // Has an active elite subscription below; activateFromPayment maintains
      // isPremium === (tier !== "free"), so the seed must match that invariant.
      isPremium: true,
      completedGigs: 87,
      onTimeRate: 0.98,
      aiTrustScore: 92,
      createdAt: daysAgo(200),
    },
  });

  const local2 = await prisma.user.create({
    data: {
      id: "seed-local-2",
      email: "fatima@services.test",
      name: "Fatima Begum",
      role: "local",
      title: "Interior painter",
      skills: list("painting", "interior", "texture", "waterproofing"),
      hourlyRate: 500,
      serviceRadiusKm: 15,
      location: "Bengaluru, KA",
      completedGigs: 42,
      onTimeRate: 0.88,
      createdAt: daysAgo(60),
    },
  });

  // A brand-new unverified provider, so the KYC queue has something pending.
  const pendingProvider = await prisma.user.create({
    data: {
      id: "seed-digital-3",
      email: "newbie@dev.test",
      name: "Karan Malhotra",
      role: "digital",
      title: "Junior developer",
      skills: list("javascript", "react"),
      hourlyRate: 800,
      location: "Delhi, DL",
      createdAt: daysAgo(3),
    },
  });

  // A suspended account, so the admin users screen shows both states.
  await prisma.user.create({
    data: {
      id: "seed-suspended-1",
      email: "spam@bad.test",
      name: "Blocked Account",
      role: "digital",
      isSuspended: true,
      createdAt: daysAgo(20),
    },
  });

  const allUsers = [
    admin,
    business,
    customer,
    digital,
    digital2,
    local,
    local2,
    pendingProvider,
  ];

  console.log("Seeding notification prefs, referrals, presence…");

  // Codes must look like generated ones: CODE_ALPHABET excludes 0/O/1/I
  // because these get read aloud, and never contains "-". Assigned from a
  // fixed list so they stay unique and stable across re-seeds.
  const REFERRAL_CODES = [
    "SRNADMN2",
    "SRNBIZ34",
    "SRNCUST5",
    "SRNDEV77",
    "SRNDSGN8",
    "SRNELEC9",
    "SRNPNT23",
    "SRNJUNR4",
  ];

  for (const [index, u] of allUsers.entries()) {
    await prisma.notificationPref.create({ data: { userId: u.id } });
    await prisma.referral.create({
      data: {
        userId: u.id,
        code: REFERRAL_CODES[index],
        signupCount: u.id === digital.id ? 7 : u.id === local.id ? 3 : 0,
        rewardPoints: u.id === digital.id ? 700 : u.id === local.id ? 300 : 0,
      },
    });
    await prisma.presence.create({
      data: {
        userId: u.id,
        isOnline: u.id === digital.id || u.id === customer.id,
        lastHeartbeat: new Date(),
      },
    });
  }

  console.log("Seeding requirements…");

  const req1 = await prisma.requirement.create({
    data: {
      creatorId: business.id,
      title: "Build a customer-facing shipment tracking portal",
      category: "Web Development",
      description:
        "We need a portal where our customers can track shipments in real time. Auth, a dashboard, and a status timeline. Existing REST API to integrate against.",
      skillsNeeded: list("react", "nextjs", "typescript"),
      minBudget: 80000,
      maxBudget: 150000,
      location: "Remote",
      status: "open",
      createdAt: daysAgo(12),
    },
  });

  const req2 = await prisma.requirement.create({
    data: {
      creatorId: business.id,
      title: "Redesign our marketing site",
      category: "Design",
      description:
        "Current site is six years old. Need a modern redesign, five pages, plus a component library we can extend.",
      skillsNeeded: list("figma", "ui", "branding"),
      minBudget: 40000,
      maxBudget: 75000,
      location: "Remote",
      status: "in_progress",
      createdAt: daysAgo(40),
    },
  });

  const req3 = await prisma.requirement.create({
    data: {
      creatorId: customer.id,
      title: "Rewire two bedrooms and install inverter backup",
      category: "Electrical",
      description:
        "Old wiring in two bedrooms needs replacing. Also want an inverter installed to cover fans and lights during outages.",
      skillsNeeded: list("electrical", "wiring", "inverter"),
      minBudget: 15000,
      maxBudget: 30000,
      location: "Bengaluru, KA",
      status: "open",
      createdAt: daysAgo(5),
    },
  });

  const req4 = await prisma.requirement.create({
    data: {
      creatorId: customer.id,
      title: "Paint living room and hallway",
      category: "Painting",
      description: "Roughly 600 sq ft. Want a textured finish on one feature wall.",
      skillsNeeded: list("painting", "interior", "texture"),
      minBudget: 12000,
      maxBudget: 20000,
      location: "Bengaluru, KA",
      status: "closed",
      createdAt: daysAgo(70),
    },
  });

  await prisma.user.update({
    where: { id: business.id },
    data: { postedRequirementsCount: 2 },
  });
  await prisma.user.update({
    where: { id: customer.id },
    data: { postedRequirementsCount: 2 },
  });

  console.log("Seeding quotes…");

  const quote1 = await prisma.quote.create({
    data: {
      requirementId: req1.id,
      senderId: digital.id,
      receiverId: business.id,
      amount: 125000,
      durationDays: 30,
      message:
        "I've built three tracking dashboards on similar APIs. Can start Monday and ship a staging build in week two.",
      status: "shortlisted",
      createdAt: daysAgo(10),
    },
  });

  await prisma.quote.create({
    data: {
      requirementId: req1.id,
      senderId: pendingProvider.id,
      receiverId: business.id,
      amount: 70000,
      durationDays: 45,
      message: "Keen to take this on. Would be my largest project so far.",
      status: "pending",
      createdAt: daysAgo(8),
    },
  });

  const quote2 = await prisma.quote.create({
    data: {
      requirementId: req2.id,
      senderId: digital2.id,
      receiverId: business.id,
      amount: 68000,
      durationDays: 21,
      message: "Five pages plus a Figma component library you can hand to any dev.",
      status: "accepted",
      createdAt: daysAgo(38),
    },
  });

  await prisma.quote.create({
    data: {
      requirementId: req3.id,
      senderId: local.id,
      receiverId: customer.id,
      amount: 24000,
      durationDays: 3,
      message:
        "Includes materials and a 1-year warranty on the wiring. Inverter is a 1.5kVA unit.",
      status: "pending",
      createdAt: daysAgo(4),
    },
  });

  const quote4 = await prisma.quote.create({
    data: {
      requirementId: req4.id,
      senderId: local2.id,
      receiverId: customer.id,
      amount: 17500,
      durationDays: 4,
      status: "accepted",
      createdAt: daysAgo(68),
    },
  });

  console.log("Seeding bookings…");

  await prisma.booking.create({
    data: {
      quoteId: quote2.id,
      requirementId: req2.id,
      customerId: business.id,
      providerId: digital2.id,
      amount: 68000,
      status: "in_progress",
      scheduledFor: daysAgo(30),
      createdAt: daysAgo(37),
    },
  });

  const booking2 = await prisma.booking.create({
    data: {
      quoteId: quote4.id,
      requirementId: req4.id,
      customerId: customer.id,
      providerId: local2.id,
      amount: 17500,
      status: "completed",
      scheduledFor: daysAgo(64),
      completedAt: daysAgo(60),
      createdAt: daysAgo(67),
    },
  });

  const booking3 = await prisma.booking.create({
    data: {
      customerId: customer.id,
      providerId: local.id,
      amount: 8500,
      status: "completed",
      scheduledFor: daysAgo(25),
      completedAt: daysAgo(24),
      createdAt: daysAgo(28),
    },
  });

  // An upcoming booking so the availability screen has a real conflict.
  await prisma.booking.create({
    data: {
      customerId: customer.id,
      providerId: local.id,
      amount: 4500,
      status: "confirmed",
      scheduledFor: daysAhead(3),
      createdAt: daysAgo(1),
    },
  });

  // A disputed booking, so the admin disputes screen is not empty.
  const booking4 = await prisma.booking.create({
    data: {
      customerId: business.id,
      providerId: digital.id,
      amount: 45000,
      status: "disputed",
      scheduledFor: daysAgo(50),
      createdAt: daysAgo(55),
    },
  });

  console.log("Seeding reviews…");

  await prisma.review.create({
    data: {
      bookingId: booking2.id,
      authorId: customer.id,
      subjectId: local2.id,
      rating: 5,
      comment:
        "Finished a day early and the feature wall looks excellent. Cleaned up properly too.",
      createdAt: daysAgo(59),
    },
  });

  await prisma.review.create({
    data: {
      bookingId: booking3.id,
      authorId: customer.id,
      subjectId: local.id,
      rating: 4,
      comment: "Good work, arrived a bit late but explained the delay.",
      createdAt: daysAgo(23),
    },
  });

  for (const id of [local.id, local2.id]) {
    const agg = await prisma.review.aggregate({
      where: { subjectId: id },
      _avg: { rating: true },
      _count: { _all: true },
    });
    await prisma.user.update({
      where: { id },
      data: {
        rating: agg._avg.rating ?? 0,
        reviewsCount: agg._count._all,
      },
    });
  }

  // Providers with no reviews still need a plausible rating for search sorting.
  await prisma.user.update({
    where: { id: digital.id },
    data: { rating: 4.8, reviewsCount: 26 },
  });
  await prisma.user.update({
    where: { id: digital2.id },
    data: { rating: 4.6, reviewsCount: 18 },
  });

  console.log("Seeding conversations and messages…");

  const convKey = convKeyFor(business.id, digital.id);
  const conv1 = await prisma.conversation.create({
    data: {
      participantIds: convKey,
      participants: {
        create: [{ userId: business.id }, { userId: digital.id }],
      },
      lastMessageAt: daysAgo(1),
      lastMessageText: "Sounds good — I'll send the staging link Thursday.",
      createdAt: daysAgo(10),
    },
  });

  const thread: [string, string, string, number][] = [
    [business.id, digital.id, "Hi Arjun — your quote looks strong. Do you have availability starting next week?", 9],
    [digital.id, business.id, "Yes, I can start Monday. I'd want API docs before then if possible.", 9],
    [business.id, digital.id, "Sending them over now. Anything else you need from us?", 8],
    [digital.id, business.id, "A staging environment and a test account would help.", 8],
    [business.id, digital.id, "Both set up. Check your email.", 2],
    [digital.id, business.id, "Sounds good — I'll send the staging link Thursday.", 1],
  ];

  for (const [senderId, receiverId, text, ago] of thread) {
    await prisma.message.create({
      data: {
        conversationId: conv1.id,
        senderId,
        receiverId,
        text,
        read: ago > 2,
        createdAt: daysAgo(ago),
      },
    });
  }

  const conv2 = await prisma.conversation.create({
    data: {
      participantIds: convKeyFor(customer.id, local.id),
      participants: {
        create: [{ userId: customer.id }, { userId: local.id }],
      },
      lastMessageAt: daysAgo(4),
      lastMessageText: "I can come by Saturday morning to look at the wiring.",
      createdAt: daysAgo(5),
    },
  });

  await prisma.message.create({
    data: {
      conversationId: conv2.id,
      senderId: customer.id,
      receiverId: local.id,
      text: "Hi Suresh, are you free this weekend to quote for the rewiring job?",
      read: true,
      createdAt: daysAgo(5),
    },
  });
  await prisma.message.create({
    data: {
      conversationId: conv2.id,
      senderId: local.id,
      receiverId: customer.id,
      text: "I can come by Saturday morning to look at the wiring.",
      read: false,
      createdAt: daysAgo(4),
    },
  });

  // A flagged message so the moderation queue has content.
  //
  // It gets its OWN conversation: putting it in conv1 (business + digital)
  // while sending it from pendingProvider produced a row no repository could
  // create — invisible to its own sender, yet counted in the recipient's
  // unread badge for a thread the sender isn't in.
  const conv3 = await prisma.conversation.create({
    data: {
      participantIds: convKeyFor(business.id, pendingProvider.id),
      participants: {
        create: [{ userId: business.id }, { userId: pendingProvider.id }],
      },
      lastMessageAt: daysAgo(6),
      lastMessageText:
        "Contact me directly on WhatsApp at 98xxxxxx to skip the platform fee.",
      createdAt: daysAgo(6),
    },
  });

  const flaggedMessage = await prisma.message.create({
    data: {
      conversationId: conv3.id,
      senderId: pendingProvider.id,
      receiverId: business.id,
      text: "Contact me directly on WhatsApp at 98xxxxxx to skip the platform fee.",
      isFlagged: true,
      createdAt: daysAgo(6),
    },
  });

  console.log("Seeding disputes, verification, portfolio…");

  await prisma.dispute.create({
    data: {
      bookingId: booking4.id,
      raisedById: business.id,
      reason: "Work not delivered",
      details:
        "Agreed scope was three modules; only one was delivered by the deadline and communication stopped.",
      status: "open",
      // DisputeRepository.create would have captured this. Without it,
      // resolving the dispute falls back to "completed" for a booking that was
      // never completed.
      previousBookingStatus: "in_progress",
      createdAt: daysAgo(20),
    },
  });

  await prisma.verificationRequest.create({
    data: {
      userId: pendingProvider.id,
      docType: "aadhaar",
      docUrls: list("/uploads/seed/kyc-karan-front.jpg", "/uploads/seed/kyc-karan-back.jpg"),
      status: "pending",
      createdAt: daysAgo(2),
    },
  });

  await prisma.verificationRequest.create({
    data: {
      userId: local2.id,
      docType: "pan",
      docUrls: list("/uploads/seed/kyc-fatima.jpg"),
      status: "pending",
      createdAt: daysAgo(1),
    },
  });

  await prisma.verificationRequest.create({
    data: {
      userId: digital.id,
      docType: "pan",
      docUrls: list("/uploads/seed/kyc-arjun.jpg"),
      status: "approved",
      reviewedById: admin.id,
      reviewNote: "Documents match profile details.",
      reviewedAt: daysAgo(140),
      createdAt: daysAgo(145),
    },
  });

  const portfolio = [
    [digital.id, "Logistics tracking dashboard", "Real-time shipment tracking for a 200-vehicle fleet.", true],
    [digital.id, "B2B invoicing platform", "Multi-tenant invoicing with GST compliance.", false],
    [digital.id, "Field ops mobile app", "Offline-first React Native app for field engineers.", false],
    [digital2.id, "Fintech design system", "48-component library shipped to three product teams.", true],
    [digital2.id, "SaaS marketing site", "Full rebrand and five-page marketing site.", false],
  ] as const;

  for (const [userId, title, description, isFeatured] of portfolio) {
    await prisma.portfolioItem.create({
      data: {
        userId,
        title,
        description,
        isFeatured,
        likeCount: Math.floor(Math.random() * 40),
        imageUrl: null,
      },
    });
  }

  console.log("Seeding availability…");

  for (const providerId of [local.id, local2.id, digital.id]) {
    for (let day = 1; day <= 6; day++) {
      await prisma.workingHours.create({
        data: {
          userId: providerId,
          dayOfWeek: day,
          startTime: day === 6 ? "10:00" : "09:00",
          endTime: day === 6 ? "14:00" : "18:00",
          isEnabled: true,
        },
      });
    }
  }

  const blocked = new Date();
  blocked.setUTCHours(0, 0, 0, 0);
  // setUTCDate, not setDate: local-calendar arithmetic shifts by an hour across
  // a DST boundary and the result stops being exactly UTC midnight, which
  // breaks the exact-equality blocked-date lookup.
  blocked.setUTCDate(blocked.getUTCDate() + 5);
  await prisma.blockedDate.create({
    data: { userId: local.id, date: blocked, reason: "Family function" },
  });

  console.log("Seeding subscriptions…");

  await prisma.subscription.create({
    data: {
      userId: digital.id,
      tier: "pro",
      status: "active",
      currentPeriodEnd: daysAhead(18),
      razorpayOrderId: "order_seedpro001",
      razorpayPaymentId: "pay_seedpro001",
    },
  });

  await prisma.subscription.create({
    data: {
      userId: local.id,
      tier: "elite",
      status: "active",
      currentPeriodEnd: daysAhead(9),
      razorpayOrderId: "order_seedelite001",
      razorpayPaymentId: "pay_seedelite001",
    },
  });

  await prisma.subscription.create({
    data: { userId: digital2.id, tier: "free", status: "active" },
  });

  console.log("Seeding notifications, profile views, flags, audit…");

  const notifications = [
    [business.id, "quote_received", "New quote on your requirement", "Arjun Nair submitted a quote of ₹1,25,000.", false],
    [business.id, "message", "New message", "Arjun Nair sent you a message.", false],
    [customer.id, "quote_received", "New quote on your requirement", "Suresh Kumar quoted ₹24,000 for your rewiring job.", false],
    [customer.id, "booking_completed", "Booking completed", "Your painting job is marked complete. Leave a review?", true],
    [digital.id, "quote_shortlisted", "You've been shortlisted", "Northwind Logistics shortlisted your quote.", false],
    [digital2.id, "booking_confirmed", "Booking confirmed", "Your redesign project is now in progress.", true],
    [local.id, "review_received", "New review", "Meera Iyer left you a 4-star review.", true],
    [admin.id, "dispute_opened", "New dispute", "A dispute was raised on booking #" + booking4.id.slice(0, 6), false],
  ] as const;

  for (const [userId, type, title, body, read] of notifications) {
    await prisma.notification.create({
      data: { userId, type, title, body, read },
    });
  }

  for (let i = 0; i < 60; i++) {
    await prisma.profileView.create({
      data: {
        subjectId: i % 2 === 0 ? digital.id : local.id,
        viewerId: i % 3 === 0 ? business.id : customer.id,
        createdAt: daysAgo(Math.floor(Math.random() * 30)),
      },
    });
  }

  const flags = [
    ["web_push", false, "Web push notifications via FCM. Deferred — see WEB_MIGRATION_PLAN.md §5."],
    ["referrals", true, "Referral programme and leaderboard."],
    ["disputes", true, "Allow customers to raise disputes on bookings."],
    ["subscriptions", true, "Paid provider subscription tiers."],
    ["ai_matching", false, "Experimental AI requirement/provider matching."],
  ] as const;

  for (const [key, enabled, description] of flags) {
    await prisma.featureFlag.create({ data: { key, enabled, description } });
  }

  const auditEvents = [
    [admin.id, "user.verified", digital.id],
    [admin.id, "verification.approved", digital.id],
    [admin.id, "user.suspended", "seed-suspended-1"],
    [business.id, "requirement.created", req1.id],
    [digital.id, "quote.submitted", quote1.id],
  ] as const;

  for (const [actorId, action, target] of auditEvents) {
    await prisma.auditEvent.create({
      data: { actorId, action, target, ip: "203.0.113.42" },
    });
  }

  await prisma.report.create({
    data: {
      reporterId: business.id,
      reportedId: pendingProvider.id,
      targetType: "message",
      // createReport requires targetId to flag the message; without it the
      // moderation queue showed a message report that linked nowhere.
      targetId: flaggedMessage.id,
      reason: "Attempting to take payment off-platform",
      details: "Asked to move the conversation to WhatsApp to avoid fees.",
      status: "open",
    },
  });

  const counts = {
    users: await prisma.user.count(),
    requirements: await prisma.requirement.count(),
    quotes: await prisma.quote.count(),
    bookings: await prisma.booking.count(),
    messages: await prisma.message.count(),
    reviews: await prisma.review.count(),
    disputes: await prisma.dispute.count(),
    verifications: await prisma.verificationRequest.count(),
    notifications: await prisma.notification.count(),
  };

  console.log("\nSeed complete:");
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(16)} ${v}`);
  }
  console.log(
    "\nSeeded logins (ids are placeholders, not real Firebase uids):",
  );
  console.log("  admin     seed-admin-1     admin@srn.test");
  console.log("  business  seed-business-1  ravi@northwind.test");
  console.log("  customer  seed-customer-1  meera@example.test");
  console.log("  digital   seed-digital-1   arjun@dev.test");
  console.log("  local     seed-local-1     suresh@services.test");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
