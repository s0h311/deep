import { defineConfig } from 'oxlint'

export default defineConfig({
  options: {
    typeAware: true,
    typeCheck: true,
  },
  plugins: ['unicorn', 'typescript', 'oxc', 'vitest', 'node', 'import', 'promise'],
  ignorePatterns: ['*.gen.ts', 'packages-deep-server/src/infrastructure/Database/migrations'],
  rules: {
    'max-params': ['error', { max: 2 }],
    'typescript/consistent-type-definitions': ['error', 'type'],
    eqeqeq: 'error',
    'typescript/no-array-delete': 'error',
    'typescript/no-non-null-assertion': 'error',
    'prefer-const': 'error',
    'unicorn/no-array-sort': ['error', { allowExpressionStatement: false }],
    'unicorn/no-array-reverse': ['error', { allowExpressionStatement: false }],
  },
})
