/**
 * Query-building helpers for the Prisma implementation.
 *
 * Two problems these exist to solve, both of which produced wrong results:
 *
 * 1. Prisma's `contains` compiles to `LIKE '%value%'` and does NOT escape `%`
 *    or `_` on any connector. A user searching "50%" matched every row, and on
 *    the admin user search that turned a filtered query into a full listing.
 *
 * 2. List columns are comma-joined, so an unanchored `contains` matched
 *    substrings across token boundaries: searching skill "java" matched a
 *    provider who listed "javascript", and "air" matched "repair".
 */

/**
 * Strips SQL LIKE wildcards from user input.
 *
 * Prisma exposes no ESCAPE clause, so the wildcards are removed rather than
 * escaped. That makes a literal "%" unsearchable, which is an acceptable
 * trade for not letting one character disable the filter.
 */
export function sanitizeSearchTerm(input: string): string {
  return input.replace(/[%_\\]/g, "").trim();
}

/**
 * Normalises a free-text query, returning null when there is nothing to
 * filter on.
 *
 * Whitespace-only input previously passed the truthiness gate and produced
 * `contains: ""`, a filter that matches everything instead of being skipped.
 */
export function searchTerm(input: string | undefined): string | null {
  if (!input) return null;
  const cleaned = sanitizeSearchTerm(input);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Builds the exact-token match for a comma-joined list column.
 *
 * Relies on list columns being stored comma-DELIMITED (",react,nextjs,") by
 * `joinList`, so a token is only matched between two commas. See mappers.ts.
 */
export function listTokenMatch(token: string): string {
  return `,${sanitizeSearchTerm(token).toLowerCase()},`;
}
