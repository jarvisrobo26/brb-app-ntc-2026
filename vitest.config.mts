import { defineConfig } from 'vitest/config'

// Optional, off-instance fast loop (Layer 1 in docs/research/tdd-patterns-and-scope.md).
// Scoped deliberately to pure, Glide-free logic only — the SDK does NOT run these;
// the mandated on-instance coverage is the ATF suite under src/fluent/tests/. Tests
// live under test/ (NOT src/server/) so the Now SDK never bundles them as server
// modules. The setup file shims the platform `Class` global so a Script Include .js
// can be imported for its pure exports without pulling in Glide.
//
// Run the suite with `pnpm test` (vitest is a pinned devDependency). It is a local
// fast loop only — `now-sdk build` neither runs nor depends on it.
export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        setupFiles: ['./test/vitest.setup.js'],
        environment: 'node',
    },
})
