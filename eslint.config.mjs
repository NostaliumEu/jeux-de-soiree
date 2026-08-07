import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({ baseDirectory: __dirname })

const PURETE =
  'Les machines de jeu doivent rester des fonctions pures : le temps et l’aléa arrivent par ctx.'

export default [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },

  ...compat.extends('next/core-web-vitals', 'next/typescript'),

  // Garde-fou de pureté des machines de jeu (spec §4.3).
  // Une machine ne connaît ni le réseau, ni la base, ni l’horloge, ni Math.random.
  {
    files: ['src/games/**/machine.ts', 'src/modes/**/machine.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: PURETE },
        { object: 'Date', property: 'now', message: PURETE },
        { object: 'crypto', property: 'randomUUID', message: PURETE },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: PURETE },
        { name: 'fetch', message: PURETE },
        { name: 'performance', message: PURETE },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react-*',
                'next',
                'next/*',
                '@supabase/*',
                'node:*',
                'fs',
                'path',
                '@/server/*',
                '@/client/*',
                '@/ui/*',
                '@/games/*',
                '@/modes/*',
              ],
              message:
                'Une machine n’importe que @/engine/*, ses propres fichiers relatifs et son contenu.',
            },
          ],
        },
      ],
    },
  },
]
