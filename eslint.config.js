import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // The service worker runs in a worker global, not the browser or Node one, and
// is shipped verbatim rather than compiled. Linting it against either set of
// globals only produces noise about `self` and `caches`.
  { ignores: ['dist', 'node_modules', 'coverage', 'public/sw.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },
);
