/**
 * Pre-deployment configuration check.
 *
 * Run against the environment you are about to deploy with:
 *
 *   NODE_ENV=production DATABASE_URL=... pnpm preflight
 *
 * Exits non-zero on anything fatal, so it can gate a deploy. Every check here
 * covers a failure that would otherwise be SILENT — see src/lib/config/preflight.ts.
 */
import { checkConfiguration, fatalProblems } from "../src/lib/config/preflight";

const problems = checkConfiguration();

if (problems.length === 0) {
  console.log("✓ Configuration looks deployable.");
  process.exit(0);
}

for (const problem of problems) {
  const label = problem.severity === "fatal" ? "FATAL  " : "warning";
  console.log(`${label} ${problem.setting}\n         ${problem.message}\n`);
}

const fatal = fatalProblems(problems);
if (fatal.length > 0) {
  console.error(
    `${fatal.length} fatal problem(s). Refusing to call this deployable.`,
  );
  process.exit(1);
}

console.log("No fatal problems; warnings above are worth reading.");
