import "server-only";

import { z } from "zod";
import { defineOperation } from "../core";
import { getDashboard } from "@/lib/services/dashboard.service";

/** The signed-in user's own dashboard — the shape depends on their role. */
export const get = defineOperation({
  name: "dashboard.get",
  kind: "query",
  access: "authenticated",
  input: z.void(),
  // No id parameter by design: a dashboard is always the caller's own, so there
  // is nothing to authorize and no way to ask for someone else's.
  handler: async (_input, { user }) => getDashboard(user),
});
