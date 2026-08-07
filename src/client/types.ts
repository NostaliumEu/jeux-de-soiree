import type { BoardState } from '@/modes/board/machine'
import type { PlayerId } from '@/engine/types'

export interface JoueurPublic {
  id: string
  nickname: string
  avatar: string
  participations: number
}

export interface SessionPublique {
  id: string
  code: string
  host_player_id: string | null
  mode: 'free' | 'board'
  status: 'lobby' | 'playing' | 'results' | 'finished' | 'expired' | 'closed'
  settings: { totalRounds?: number }
  current_round_id: string | null
  last_game_key: string | null
}

export interface manchePublique {
  id: string
  session_id: string
  game_key: string
  format: string
  participants: string[]
  status: 'betting' | 'playing' | 'done'
  bets: Record<PlayerId, PlayerId>
  result: { ranking: PlayerId[][]; sips: Record<PlayerId, number> } | null
  started_at: string
}

export interface Instantane {
  session: SessionPublique
  joueurs: JoueurPublic[]
  manche: manchePublique | null
  etatPublic: Record<string, unknown> | null
  /** Incrémenté à chaque action appliquée : sert à ne recharger que ce qui a bougé. */
  version: number
  plateau: BoardState | null
  gorgees: Record<string, number>
}

export interface Identite {
  code: string
  sessionId: string
  playerId: string
  token: string
}

/** Contrat commun à tous les écrans de jeu. */
export interface EcranProps<Etat> {
  etat: Etat
  moi: string
  joueurs: JoueurPublic[]
  participe: boolean
  /** Décalage d'horloge avec le serveur, en millisecondes. */
  decalage: number
  vuePrivee: unknown
  envoyer: (payload: unknown) => Promise<void>
}

export function nomDe(joueurs: JoueurPublic[], id: string): string {
  return joueurs.find((j) => j.id === id)?.nickname ?? '???'
}

export function avatarDe(joueurs: JoueurPublic[], id: string): string {
  return joueurs.find((j) => j.id === id)?.avatar ?? '👤'
}
