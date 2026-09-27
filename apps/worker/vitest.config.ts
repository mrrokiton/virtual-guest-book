import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each file boots an in-process Postgres (PGlite) and applies migrations.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
