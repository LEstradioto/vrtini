import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['dist/**', 'node_modules/**', 'test/ui/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'json'],
      reportsDirectory: 'tmp/quality/coverage',
      include: ['src/**/*.ts', 'web/server/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        'src/types/**',
        'src/index.ts',
        'web/server/index.ts',
        'dist/**',
      ],
    },
  },
});
