// Point every test at the scratch database created by global-setup.
//
// NODE_ENV must be set: the mock auth and payment providers refuse to construct
// when it is "production", and several guards branch on it. Its type is
// readonly, so it is assigned through a widened reference rather than casting
// at each use.
const env = process.env as Record<string, string | undefined>;

env.DATABASE_URL = "file:./test.db";
env.NODE_ENV = "test";
env.AUTH_PROVIDER = "mock";
env.PAYMENT_PROVIDER = "mock";
env.STORAGE_PROVIDER = "local";
env.OTP_PROVIDER = "console";
