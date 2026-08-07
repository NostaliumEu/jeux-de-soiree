import type { GameDefinition } from '@/engine/types'

export const GARDIEN_ROUNDS = 3
export const GARDIEN_CHOOSE_TIMEOUT_MS = 20_000
/** Gorgées pour un tireur arrêté, et pour le gardien par but encaissé. */
export const GARDIEN_SIPS_PER_EVENT = 1

export const definition: GameDefinition = {
  key: 'gardien',
  name: 'Le Gardien',
  tagline: 'Un seul dans les buts, tous les autres au tir. Trois tentatives.',
  emoji: '🥅',
  formats: ['asymetrique'],
  /** 1 gardien + 2 tireurs au minimum. */
  minPlayers: 3,
  /** 1 gardien + 5 tireurs au maximum : au-delà, la révélation devient illisible. */
  maxPlayers: 6,
  estimatedSeconds: 90,
  supportsBoard: true,
}
