import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const testImports = {
  group: [
    'vitest',
    '@vitest/*',
    '**/tests/**',
    '**/*.test',
    '**/*.integration',
  ],
  message: 'Los fixtures y mocks solo pueden importarse desde pruebas.',
};

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  nextPlugin.configs['core-web-vitals'],
  reactHooks.configs.flat.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  prettier,
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/db/**', '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='from'][callee.object.name!='Array'][callee.object.name!='Buffer']",
          message:
            'Las consultas de datos deben estar en los repositorios de src/db.',
        },
        {
          selector: "CallExpression[callee.property.name='rpc']",
          message: 'Las operaciones de base de datos deben estar en src/db.',
        },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [testImports] }],
    },
  },
  {
    files: ['src/app/**/*.{ts,tsx}', 'src/modules/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            testImports,
            {
              group: [
                '@/worker/**',
                '**/worker/**',
                '@/db/repositories',
                '**/db/repositories',
                '@/db/service-client',
                '**/db/service-client',
                'openai',
              ],
              message:
                'Usa el acceso de usuario verificado; las operaciones privilegiadas pertenecen al worker.',
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    '.next/**',
    '.cache/**',
    'out/**',
    'coverage/**',
    'next-env.d.ts',
  ]),
]);
