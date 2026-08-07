import type { GameDefinition } from '@/engine/types'

/** Nombre de coups pour remplir la jauge. */
export const SPRINT_TARGET = 60
/** Décompte avant le départ, pour que tout le monde parte ensemble. */
export const SPRINT_COUNTDOWN_MS = 3_000
/** Au-delà, on arrête les frais et on classe selon les jauges. */
export const SPRINT_LIMIT_MS = 45_000
/** Coups regroupés par paquet : un envoi par tap noierait le serveur. */
export const SPRINT_BATCH_MS = 250
export const SPRINT_MAX_BATCH = 25
/**
 * Cadence humaine maximale retenue. Un pouce très rapide plafonne autour de
 * 12 coups par seconde ; on double pour ne léser personne, tout en fermant la
 * porte à celui qui annoncerait la jauge pleine d'un seul envoi.
 */
export const SPRINT_MAX_PAR_SECONDE = 25
/** Gorgées selon la place : le vainqueur est épargné, le dernier trinque. */
export const SPRINT_SIPS: readonly number[] = [0, 1, 2, 3]

export const definition: GameDefinition = {
  key: 'sprint',
  name: 'Le Sprint',
  tagline: 'Matraque ton écran. Le premier à remplir sa jauge est tranquille.',
  emoji: '🏁',
  formats: ['tous', 'duel'],
  minPlayers: 2,
  maxPlayers: null,
  estimatedSeconds: 45,
  supportsBoard: true,
}
