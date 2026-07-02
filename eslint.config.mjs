import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * Minimal, app-rule-only lint config. Deliberately NO preset rulesets —
 * TypeScript already covers correctness, and this file exists purely to
 * make the project's hard UI/architecture rules machine-enforced so they
 * can't regress. Add new rules here as they're ratified (see the todo).
 */
export default [
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // Registered (but off) so the codebase's existing
    // `eslint-disable-line react-hooks/exhaustive-deps` comments — written for
    // editor tooling — don't error as references to an unknown rule. Unused
    // directives aren't reported for the same reason: those comments are
    // intentional documentation of deliberate dependency choices.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/exhaustive-deps': 'off',
      'no-restricted-syntax': [
        'error',
        {
          // App rule: ALL tooltips go through the custom <Tooltip> component,
          // never the native title attribute (slow to appear, unstylable).
          // Targets lowercase (DOM) elements only, so component props like
          // <Modal title="…"> (a dialog header, not a tooltip) stay legal.
          selector: "JSXOpeningElement[name.name=/^[a-z]/] > JSXAttribute[name.name='title']",
          message: 'Native title= tooltips are banned (app rule). Use <Tooltip content={…}> — or <TruncatedText> for truncated one-line labels.',
        },
      ],
    },
  },
]
