---
name: review-gate-reality
description: Half the review agents the SRN brief assumes do not exist here; user decided on 2026-08-01 to run inline reviews and never report the pipeline exit condition as met.
metadata:
  type: project
---

The SRN migration brief assumes `database-reviewer`, `test-executor`, `ux-reviewer`, `accessibility-reviewer`, `release-auditor` and a `/full-review-pipeline` command. None exist in this environment. Available: `code-reviewer`, `code-simplifier`, `security-reviewer`, `architecture-reviewer`, `risk-classifier`, `performance-reviewer`, `test-generater`.

**Why:** user decision recorded 2026-08-01 — use what exists, perform missing reviews inline and label them as inline. The brief's stated exit condition (`/full-review-pipeline` returning APPROVED) cannot be met and must not be reported as met.

**How to apply:** when asked whether a phase is cleared to ship, say which reviews actually ran and which were done inline. Do not imply a gate passed that has no agent behind it. See [[srn-web-migration-context]].