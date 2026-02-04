import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

const TEST_FILES = ['**/*.test.ts', '**/*.spec.ts'];

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  prettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
    },
  },
  {
    files: TEST_FILES,
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'web/client/**',
      '*.config.js',
      'playwright.config.ts',
      'test/ui/**',
      'scripts/**',
      'docker/**',
    ],
  }
);
