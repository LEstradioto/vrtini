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

      // Quality metrics (warn-only; gated by `npm run quality` against
      // tools/quality-thresholds.json using a ratchet — current counts
      // become the ceiling and must not grow). Thresholds match the
      // codeminer42 playbook.
      complexity: ['warn', 6],
      'max-lines-per-function': [
        'warn',
        { max: 15, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-lines': ['warn', { max: 100, skipBlankLines: true, skipComments: true }],
      'max-params': ['warn', 4],
    },
  },
  {
    files: TEST_FILES,
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Test files are naturally long (fixtures, parametrized cases) and
      // their cyclomatic complexity isn't a quality signal — gate on
      // production code only.
      complexity: 'off',
      'max-lines-per-function': 'off',
      'max-lines': 'off',
      'max-params': 'off',
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
