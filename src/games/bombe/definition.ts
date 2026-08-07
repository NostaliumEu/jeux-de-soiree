import type { GameDefinition } from '@/engine/types'

/** Fenêtre d'explosion. La borne haute est publique, l'instant exact ne l'est pas. */
export const BOMBE_MIN_MS = 6_000
export const BOMBE_MAX_MS = 25_000
/** Trois explosions et la manche s'arrête. */
export const BOMBE_ROUNDS = 3
/** La sanction monte à chaque explosion : la dernière fait mal. */
export const BOMBE_SIPS: readonly number[] = [2, 3, 4]

export const definition: GameDefinition = {
  key: 'bombe',
  name: 'La Bombe',
  tagline: 'Passe-la vite. Personne ne sait quand elle explose.',
  emoji: '💣',
  formats: ['tous'],
  minPlayers: 3,
  maxPlayers: null,
  estimatedSeconds: 90,
  supportsBoard: true,
}
