import type { GameDefinition } from '@/engine/types'

/** Temps laissé pour taper son indice, puis pour voter. */
export const IMPOSTEUR_INDICE_TIMEOUT_MS = 40_000
export const IMPOSTEUR_VOTE_TIMEOUT_MS = 30_000
/** Gorgées pour l'imposteur démasqué. */
export const IMPOSTEUR_DEMASQUE_SIPS = 4
/** Gorgées pour chaque innocent quand l'imposteur passe entre les gouttes. */
export const IMPOSTEUR_RATE_SIPS = 2
/** Gorgées pour qui n'a pas donné d'indice ou pas voté à temps. */
export const IMPOSTEUR_ABSENT_SIPS = 2
export const IMPOSTEUR_MAX_INDICE = 24

export const definition: GameDefinition = {
  key: 'imposteur',
  name: 'L’Imposteur',
  tagline: 'Tout le monde a le même mot. Sauf un. À vous de le trouver.',
  emoji: '🕵️',
  formats: ['asymetrique'],
  /** En dessous de quatre, le vote se résume à une accusation : aucun intérêt. */
  minPlayers: 4,
  maxPlayers: null,
  estimatedSeconds: 180,
  supportsBoard: true,
}
