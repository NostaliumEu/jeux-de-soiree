import type { GameDefinition } from '@/engine/types'

export const UNO_MAIN_DEPART = 7
export const UNO_TOUR_TIMEOUT_MS = 45_000
/** Gorgées par carte encore en main à la fin, plafonnées. */
export const UNO_SIPS_MAX_FIN = 6
/** Gorgées pour qui encaisse une chaîne de pioches, une par carte empilée. */
export const UNO_SIPS_MAX_CHAINE = 5
/** Sanction pour avoir oublié d'annoncer son avant-dernière carte. */
export const UNO_PENALITE_UNO_CARTES = 2
export const UNO_PENALITE_UNO_SIPS = 2

export const definition: GameDefinition = {
  key: 'uno',
  name: 'UNO',
  tagline: 'Les +2 se cumulent, un +4 passe par-dessus. L’inverse, jamais.',
  emoji: '🎴',
  formats: ['tous'],
  minPlayers: 2,
  /** Au-delà de huit, le talon ne suffit plus et les tours n'en finissent pas. */
  maxPlayers: 8,
  estimatedSeconds: 480,
  /**
   * Une partie dure plusieurs minutes : bien trop long pour une case de
   * plateau, où les mini-jeux doivent s'enchaîner. Il reste accessible depuis
   * le menu du mode libre.
   */
  supportsBoard: false,
}
