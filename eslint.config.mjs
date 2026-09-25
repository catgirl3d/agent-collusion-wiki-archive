// @ts-check
import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactRefresh from 'eslint-plugin-react-refresh'
import vitest from '@vitest/eslint-plugin'

const typeCheckedFiles = [
  'web/src/**/*.{ts,tsx}',
  'web/vite.config.ts',
  'web/vitest.config.ts',
  'worker/src/**/*.ts',
  'worker/test/**/*.ts',
  'mcp/src/**/*.ts',
  'mcp/test/**/*.ts',
  'mcp/scripts/**/*.ts',
]

const nodeScriptFiles = ['web/scripts/**/*.{js,mjs}', 'mcp/scripts/**/*.{js,mjs}']

const testFiles = ['**/*.test.{ts,tsx,js,mjs}', '**/test/**/*.{ts,tsx}']

const asWarnings = (configs) =>
  configs.map((config) => ({
    ...config,
    ...(config.rules && {
      rules: Object.fromEntries(
        Object.entries(config.rules).map(([name, setting]) => {
          const severity = Array.isArray(setting) ? setting[0] : setting
          if (severity === 0 || severity === 'off') return [name, setting]
          return [name, Array.isArray(setting) ? ['warn', ...setting.slice(1)] : 'warn']
        }),
      ),
    }),
  }))

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '.kilo/**',
      'web/public/**',
      'worker/.wrangler/**',
      '.playwright-mcp/**',
      '.mcp-brain/**',
      'data/**',
      'docs/**',
    ],
  },
  {
    files: typeCheckedFiles,
    extends: [
      ...asWarnings([
        js.configs.recommended,
        ...tseslint.configs.strictTypeChecked,
        ...tseslint.configs.stylisticTypeChecked,
      ]),
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    files: nodeScriptFiles,
    extends: [...asWarnings([js.configs.recommended])],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-useless-escape': 'warn',
    },
  },
  {
    files: ['web/src/**/*.{ts,tsx}'],
    extends: [
      ...asWarnings([
        react.configs.flat.recommended,
        react.configs.flat['jsx-runtime'],
      ]),
      reactHooks.configs.flat['recommended-latest'],
      jsxA11y.flatConfigs.recommended,
      ...asWarnings([reactRefresh.configs.vite]),
    ],
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'warn',
    },
  },
  {
    files: testFiles,
    extends: [...asWarnings([vitest.configs.recommended])],
    rules: {
      'vitest/valid-expect': ['error', { maxArgs: 2 }],
      'vitest/no-conditional-expect': 'warn',
    },
  },
)
