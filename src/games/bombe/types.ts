import type { BasePublicState, PlayerId } from '@/engine/types'

/**
 * Types partagés entre la machine et l'écran.
 *
 * Ils vivent dans leur propre fichier pour une raison précise : la machine
 * importe un dictionnaire de 2,6 Mo, et l'écran ne doit surtout pas l'entraîner
 * dans le navigateur. Tant que l'écran ne touche qu'à ce fichier, le
 * dictionnaire reste côté serveur.
 */

export interface CoupBombe {
  player: PlayerId
  mot: string
  valide: boolean
  /** Renseigné quand le mot est refusé : on dit pourquoi. */
  raison?: string
}

export interface BombePublic extends BasePublicState {
  phase: 'jeu' | 'over'
  /** Tous les joueurs, éliminés compris : l'ordre de table ne bouge pas. */
  order: PlayerId[]
  currentIndex: number
  vies: Record<PlayerId, number>
  /** Du premier sorti au dernier : sert au classement final. */
  ordreElimination: PlayerId[]
  syllabe: string
  /** Les derniers mots trouvés, pour l'affichage. */
  motsRecents: string[]
  explosions: Record<PlayerId, number>
  sips: Record<PlayerId, number>
  gagnant: PlayerId | null
  dernierCoup: CoupBombe | null
  /**
   * Instant où la mèche a été allumée. Avec `deadlineAt`, il permet de dessiner
   * une mèche qui se consume — la tension du jeu tient à ce qu'on la voie.
   */
  mecheAllumeeA: number
}

export type BombeAction =
  | { type: 'mot'; mot: string }
  | { type: 'timeout' }
