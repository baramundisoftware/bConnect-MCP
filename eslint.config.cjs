const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');

module.exports = [
  {
    files: ['bconnect-*-mcp/src/**/*.ts', 'packages/mcp-core/src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/explicit-function-return-type': [
        'warn',
        {
          allowExpressions: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': [
        'warn',
        {
          allow: ['warn', 'error', 'info'],
        },
      ],
      'eqeqeq': ['error', 'always'],
      'curly': ['error', 'all'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  // REQ-QA-002: casts that switch off the generated OpenAPI types. `as never`
  // and `as unknown as T` let a handler pass any arguments as a request body,
  // so the compiler can't reject a wrong field (#171, #175). Angle-bracket
  // casts (`<never>x`) are banned outright so they can't bypass the selectors.
  // Existing `as` casts are recorded per file in eslint-suppressions.json: a
  // file's total can't grow, and a removed cast must be pruned. A cast moved
  // from one handler to another keeps the total, so CI also fails on any
  // added line with a cast (scripts/check-new-casts.sh). Tests may cast.
  {
    files: ['bconnect-*-mcp/src/**/*.ts', 'bconnect-server-template/src/**/*.ts', 'packages/mcp-core/src/**/*.ts'],
    ignores: ['**/__tests__/**'],
    // The template is a stub with placeholders, so only the cast rules apply to
    // it; its parser is set here because the block above doesn't cover it.
    languageOptions: { parser: tsparser },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "TSAsExpression[typeAnnotation.type='TSNeverKeyword']",
          message: '`as never` switches off type checking. Build the value with the generated types instead (REQ-QA-002).',
        },
        {
          selector: "TSAsExpression[expression.type='TSAsExpression'][expression.typeAnnotation.type='TSUnknownKeyword']",
          message: '`as unknown as T` switches off type checking. Build the value with the generated types instead (REQ-QA-002).',
        },
      ],
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'as', objectLiteralTypeAssertions: 'allow' }],
    },
  },
  {
    ignores: ['**/build/**', '**/node_modules/**', '**/coverage/**'],
  },
];
