import type { GameDefinition } from '@/engine/types'

export const PURPLE_SIMPLE_REWARD = 1
export const PURPLE_PURPLE_REWARD = 5
/** Nombre d'échecs qui clôt la manche en mode Plateau (spec §6.1). */
export const PURPLE_BOARD_FAILURE_LIMIT = 3
export const PURPLE_BET_TIMEOUT_MS = 30_000
/** Longueur de l'historique conservé pour l'affichage. */
export const PURPLE_HISTORY_LENGTH = 12

export const definition: GameDefinition = {
  key: 'purple',
  name: 'Purple',
  tagline: 'Rouge ou noir, plus ou moins, et le Purple à cinq gorgées.',
  emoji: '🟣',
  formats: ['tour-par-tour'],
  minPlayers: 2,
  maxPlayers: null,
  estimatedSeconds: 180,
  supportsBoard: true,
}
