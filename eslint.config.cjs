const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');

module.exports = [
  {
    files: [
      'bconnect-*-mcp/src/**/*.ts',
      'packages/mcp-core/src/**/*.ts',
      'bconnect-mcp-gateway/src/**/*.ts',
      'bconnect-server-template/src/**/*.ts',
      // The suite-wide guards. Previously outside the lint scope entirely —
      // which is how the most security-relevant tests in the repo came to be
      // the only ones nobody linted. They need to be in the SAME block as the
      // sources, not merely matched by a later rules-only override: a flat-config
      // block that sets rules without `languageOptions` leaves the file on the
      // default parser, and every TypeScript annotation becomes a parse error.
      '__tests__/**/*.ts',
      'packages/mcp-core/__tests__/**/*.ts',
    ],
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
      // `{ null: 'ignore' }` permits `x == null`, and only that.
      //
      // Every one of the 33 eqeqeq errors in this repo was that idiom, and all
      // 33 were correct: `x == null` is the standard way to test "null or
      // undefined" in one comparison, and rewriting them to
      // `x === null || x === undefined` would be 33 edits that make the code
      // longer and no safer. `==` between any other pair of types stays an
      // error, which is the part of the rule that catches real coercion bugs.
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'curly': ['error', 'all'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // The server template is scaffolding to be COPIED. It imports and declares
    // the things a new server will need — `validateOrThrow`, `DomainRules`, the
    // `args` a dispatch case receives — and the copier deletes what they do not
    // use. Flagging those as unused is flagging the template for being a
    // template; renaming them `_validateOrThrow` to satisfy a linter would ship
    // a worse starting point to every future server.
    files: ['bconnect-server-template/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    // Tests measure things and print the measurement — `[TOK-21] … -86.5%`,
    // `[v1.1] WMI index 1,934 B`. That output is how a reviewer sees the number
    // a test asserts on, and several of this project's findings are only
    // legible because a test logged them. `console.log` is deliberate here, not
    // debug residue.
    files: ['**/__tests__/**/*.ts', '**/*.test.ts'],
    rules: {
      'no-console': 'off',
      // `any` stays banned in SOURCE, where a contract exists, and is allowed
      // here — where the subject is a JSON blob that came off the wire.
      //
      // This was not a preference until 2026-08-14. Tests were never
      // type-checked at all (see tsconfig.typecheck.json), and several
      // harnesses had drifted to `JSON.parse(text) as Record<string, never>` —
      // a type with NO properties, so every `json.reach.…` access is an error
      // the moment anything looks. Typing them honestly as parsed JSON is what
      // makes the new typecheck pass, and `unknown` cannot express
      // `json.assigned.currentlyFailing` without a cast at every read, which
      // would be noise standing in for rigour. The rigour lives in the
      // assertions, not in re-declaring the server's response shape by hand.
      '@typescript-eslint/no-explicit-any': 'off',
      // Measured 2026-08-03: ALL 49 explicit-function-return-type warnings were
      // in tests and ZERO in source. So the rule was enforcing nothing on the
      // code that has a contract, and generating noise on the code that does
      // not — a `it('…', async () => {…})` callback's return type is not an
      // interface anyone depends on.
      //
      // Turning it off here is what makes the ratchet worth having: with tests
      // excluded the count is 0, so `--max-warnings 0` blocks the FIRST new
      // warning in source rather than letting a backlog re-accumulate under a
      // number that five concurrent agents kept bumping for legitimate reasons.
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
  {
    ignores: ['**/build/**', '**/node_modules/**', '**/coverage/**'],
  },
];
