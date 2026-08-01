---
name: srn-web-migration-context
description: SRN web app is a port of a separate SRN mobile repo; classification targets SRN-web-app even when the harness cwd is the mobile repo, and WEB_MIGRATION_PLAN.md is the source of truth.
metadata:
  type: project
---

`C:\Users\Admin\Downloads\SRN-web-app` (Next.js) is a port of `C:\Users\Admin\Downloads\SRN-mobile-main` (React Native). The two live side by side and the harness cwd has been the *mobile* repo on at least one run while the review target was the *web* repo.

**Why:** the migration is driven from the web repo but reference reads go to mobile, so the working directory is not a reliable signal of what is under review.

**How to apply:** always confirm which repo the request names and read via absolute paths. `WEB_MIGRATION_PLAN.md` in the web repo is the declared source of truth for what is built vs. planned (it carries a per-feature Risk column already) — read it before classifying rather than inferring phases from the file tree. Mobile is read-only reference and must not be modified.