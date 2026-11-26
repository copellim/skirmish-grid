import { defineConfig } from 'vitest/config';

// The suite is plain Node: the engine and game layers are pure TypeScript with no React, and the
// tools read fixture files off disk. Nothing here needs a DOM.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Everything the app ships, screens included — a module missing from the report would hide
      // exactly the gap this configuration exists to expose.
      include: ['src/**'],
      reporter: ['text', 'html'],
    },
  },
});
