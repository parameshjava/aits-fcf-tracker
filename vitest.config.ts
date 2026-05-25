import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    // Pure-function unit tests only. None of the modules under test
    // (loan-math, aggregate, format) touch the DOM, so we skip jsdom and
    // run in plain Node. Faster, simpler, less to maintain.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Same locale as the app — formatRupees pins en-IN, and tests assert
    // exact output ("₹1,00,000"). If the test process runs under a
    // different locale this still passes because Intl.NumberFormat respects
    // the explicit locale argument, but keep this here as a guardrail.
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts', 'src/lib/supabase/**'],
      reporter: ['text', 'html'],
    },
  },
  resolve: {
    alias: {
      // Match the tsconfig "@/*" → "src/*" path so test files can import
      // from "@/lib/…" just like the rest of the codebase.
      '@': resolve(root, 'src'),
    },
  },
})
