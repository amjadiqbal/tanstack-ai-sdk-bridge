import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20000,
    typecheck: { include: ['test/**/*.test-d.ts'], tsconfig: './tsconfig.json' },
  },
});
