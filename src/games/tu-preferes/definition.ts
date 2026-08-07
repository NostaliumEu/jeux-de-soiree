import type { GameDefinition } from '@/engine/types'

export const TP_QUESTIONS_PER_ROUND = 5
/** Répartition dans une manche : le reste est tiré parmi les questions « joueur ». */
export const TP_BINAIRE_PER_ROUND = 3
export const TP_VOTE_TIMEOUT_MS = 25_000
/** Gorgées pour la minorité sur une question binaire. */
export const TP_MINORITY_SIPS = 2
/** Gorgées pour tout le monde en cas d'égalité parfaite. */
export const TP_TIE_SIPS = 1
/** Gorgées pour qui n'a pas voté à temps. */
export const TP_NO_VOTE_SIPS = 2
/** Plafond de gorgées sur une question « qui est le plus susceptible ». */
export const TP_MAX_PLAYER_SIPS = 5

export const definition: GameDefinition = {
  key: 'tu-preferes',
  name: 'Tu préfères',
  tagline: 'Cinq questions, tout le monde vote. La minorité trinque.',
  emoji: '🗳️',
  formats: ['tous'],
  minPlayers: 3,
  maxPlayers: null,
  estimatedSeconds: 150,
  supportsBoard: true,
}
