// Minimal, deliberately narrow ESLint config (2026-07).
//
// The repo previously shipped with NO lint gate, so a React rules-of-hooks
// violation (a hook below an early return) crashed the LIVE app at runtime
// instead of failing the build — this actually happened once (a useMemo below
// the `if (!movie) return null` in movie-drawer.tsx blanked the app). This
// config exists to convert that crash class into a build-time error, and to do
// NOTHING else: no style rules, no exhaustive-deps, no next/core-web-vitals —
// so it can't fight the existing codebase or generate noise the team ignores.
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// The codebase carries legacy `// eslint-disable @next/next/... | jsx-a11y/...`
// comments from when it expected `next lint`. Since this config intentionally
// does NOT load those plugins, ESLint 9 would error ("Definition for rule not
// found") on the dangling directives. Register the referenced rules as no-ops so
// the directives resolve harmlessly — without pulling in (or activating) the
// full Next / a11y rulesets, which would flood the codebase with noise.
const noop = { create: () => ({}) };
const legacyStub = (rules) => ({ rules: Object.fromEntries(rules.map((r) => [r, noop])) });

export default tseslint.config(
  {
    ignores: [
      '.next/**', 'out/**', 'node_modules/**',
      'android/**', 'ios/**', 'public/**',
      'scripts/**', // the audit suite / admin scripts are checked via tsconfig.scripts.json
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      '@next/next': legacyStub(['no-img-element']),
      'jsx-a11y': legacyStub(['alt-text']),
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // The legacy next/jsx-a11y disable comments are intentional (they'll apply
    // if `next lint` is ever re-enabled); against our no-op stubs they read as
    // "unused", so don't warn on them — keeps the gate at a clean 0 problems.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
);
