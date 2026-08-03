// @ts-check

import rootConfig from '../../eslint.config.js'

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...rootConfig,
  {
    files: ['**/*.{ts,tsx}'],
  },
  {
    files: ['src/**'],
    rules: {
      // Solid 2 treats the effect half's return value as a cleanup slot: any
      // non-undefined, non-function value throws in dev and permanently halts
      // the reactive system (REACTIVITY_HALTED), silently, process-wide. An
      // expression-bodied arrow leaks its expression's value into that slot,
      // so effect halves must be braced blocks.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name=/^create(Render)?Effect$/][arguments.1.type='ArrowFunctionExpression'][arguments.1.body.type!='BlockStatement']",
          message:
            'Effect halves must be braced blocks returning undefined or a cleanup function: an expression-bodied arrow leaks its value into the cleanup slot and halts reactivity (REACTIVITY_HALTED).',
        },
      ],
    },
  },
  {
    files: ['**/__tests__/**'],
    rules: {},
  },
]
