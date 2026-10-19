import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**'] },
  ...tseslint.configs.strict,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // Persisted state is validated with Zod; guarded optional state uses assertions.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);
