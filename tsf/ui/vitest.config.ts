import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Component-render tests only (CommandPanel.test.tsx et al) -- the
// package's real regression sweep stays node --test on *.test.ts (see
// package.json's own "test" script comment for why: those files run
// without a DOM by design). happy-dom mirrors the root config's own
// choice (config/vitest.config.ts) rather than introducing jsdom as a
// second DOM implementation into this monorepo.
//
// Deliberately no react/react-dom alias here: this worktree's tsf/ui has
// its own separate local react+react-dom install, distinct from the
// pnpm-hoisted root copy. A test that needs an actual React render must
// import only from this package's own local react/react-dom (plain
// specifiers resolve there already) and avoid anything that pulls in the
// root copy (@testing-library/react, react-router-dom) -- mixing the two
// crashes with "Invalid hook call". See CommandPanel.test.tsx's own header
// for the real reproduction.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.tsx']
  }
})
