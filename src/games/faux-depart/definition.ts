import type { GameDefinition } from '@/engine/types'

/** Fenêtre aléatoire avant l'allumage du vert. */
export const FD_MIN_DELAY_MS = 2_000
export const FD_MAX_DELAY_MS = 7_000
/** Temps laissé pour réagir une fois le vert allumé. */
export const FD_REACTION_WINDOW_MS = 5_000
/** Pause entre deux essais, le temps d'afficher le résultat. */
export const FD_PAUSE_MS = 3_000
/**
 * Plancher humain. Un temps de réaction sous ce seuil relève de l'anticipation
 * ou de la triche, jamais du réflexe : on le traite comme un faux départ.
 */
export const FD_HUMAN_FLOOR_MS = 80
/** Au meilleur des trois essais. */
export const FD_WINS_NEEDED = 2
export const FD_SIPS = 2
export const FD_SIPS_FALSE_START = 3

export const definition: GameDefinition = {
  key: 'faux-depart',
  name: 'Le Faux Départ',
  tagline: 'Tape dès que l’écran passe au vert. Une milliseconde trop tôt et tu bois.',
  emoji: '⚡',
  formats: ['duel'],
  minPlayers: 2,
  maxPlayers: 2,
  estimatedSeconds: 60,
  supportsBoard: true,
}
