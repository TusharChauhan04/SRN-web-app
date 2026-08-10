// Point every test at the schema global-setup created and validated.
//
// NODE_ENV must be set: the mock auth and payment providers refuse to construct
// when it is "production", and several guards branch on it. Its type is
// readonly, so it is assigned through a widened reference rather than casting
// at each use.
const env = process.env as Record<string, string | undefined>;

/*
 * Derived from TEST_DATABASE_URL, never hardcoded.
 *
 * This line used to read `env.DATABASE_URL = "file:./test.db"`. Left that way
 * after the Postgres swap it would have made the whole safety story in
 * global-setup.ts theatre: that file demands TEST_DATABASE_URL, refuses a
 * missing or `public` schema, and migrates `srn_test` — and then every test
 * would have connected somewhere else entirely and failed on the first query.
 * The guarded schema would never have been touched.
 *
 * Non-null assertion is safe: global-setup runs first and throws with a full
 * explanation if the variable is absent, so reaching here without it is not a
 * state the suite can be in.
 */
env.DATABASE_URL = process.env.TEST_DATABASE_URL!;
env.DIRECT_URL = process.env.TEST_DATABASE_URL!;
env.NODE_ENV = "test";
env.AUTH_PROVIDER = "mock";
env.PAYMENT_PROVIDER = "mock";
env.STORAGE_PROVIDER = "local";
env.OTP_PROVIDER = "console";
