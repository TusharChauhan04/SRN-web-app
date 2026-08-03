// `server-only` exists to fail a build when a server module is imported into a
// client bundle. Vitest is neither environment, so it is aliased to this no-op.
// The real guard still applies to the Next.js build, which is what enforces it.
export {};
