import type { GameDefinition } from '@/engine/types'

/** Vies au départ. Deux suffisent : une partie doit tenir dans une soirée. */
export const BOMBE_VIES = 2
/** Fenêtre d'explosion, tirée au sort à chaque nouvelle mèche. */
export const BOMBE_MIN_MS = 10_000
export const BOMBE_MAX_MS = 25_000
/** Gorgées par vie perdue, puis supplément à l'élimination. */
export const BOMBE_SIPS_EXPLOSION = 2
export const BOMBE_SIPS_ELIMINATION = 3
/** Bornes acceptées pour un mot — celles du dictionnaire. */
export const BOMBE_MOT_MIN = 3
export const BOMBE_MOT_MAX = 12
/** Nombre de mots conservés à l'affichage. */
export const BOMBE_HISTORIQUE = 8

export const definition: GameDefinition = {
  key: 'bombe',
  name: 'Bombe Party',
  tagline: 'Une syllabe, un mot, et la mèche qui brûle. Trouve avant qu’elle pète.',
  emoji: '💣',
  formats: ['tous'],
  minPlayers: 2,
  maxPlayers: 10,
  estimatedSeconds: 240,
  supportsBoard: true,
}
