/**
 * Contrats partagés entre le moteur, les modes et les jeux.
 *
 * La règle qui rend tout le projet extensible : un jeu ignore totalement dans
 * quel mode il tourne. Il reçoit une liste de participants et rend un
 * `GameResult`. C'est le mode qui interprète ce résultat — affichage simple en
 * mode libre, déplacement de pions en mode Plateau. Ajouter un mode ne touche
 * jamais au code d'un jeu, et réciproquement.
 */

import type { Rng } from './rng'

export type PlayerId = string

export type PlayMode = 'free' | 'board'

export type GameFormat =
  /** exactement 2 participants */
  | 'duel'
  /** 1 solo contre K challengers */
  | 'asymetrique'
  /** tous les joueurs présents, simultanément */
  | 'tous'
  /** tous les joueurs présents, chacun son tour */
  | 'tour-par-tour'

/** Résultat normalisé rendu par TOUT mini-jeu, quel que soit son format. */
export interface GameResult {
  /** Du meilleur au moins bon. Les ex æquo sont groupés dans le même sous-tableau. */
  ranking: PlayerId[][]
  /** Gorgées bues pendant la manche, par joueur. */
  sips: Record<PlayerId, number>
}

export interface GameDefinition {
  /** Identifiant stable, utilisé en base. Ne jamais le renommer. */
  key: string
  name: string
  tagline: string
  emoji: string
  formats: GameFormat[]
  minPlayers: number
  /** `null` = pas de limite. */
  maxPlayers: number | null
  /** Sert au mode Plateau pour équilibrer le rythme d'une soirée. */
  estimatedSeconds: number
  /** Le jeu peut-il être tiré comme mini-jeu de plateau. */
  supportsBoard: boolean
}

/** Tout état public de jeu expose au moins ces champs. */
export interface BasePublicState {
  phase: string
  /**
   * Gorgées bues DEPUIS LE DÉBUT DE LA MANCHE, par joueur.
   *
   * Le total de la soirée n'est consolidé en base qu'à la fin d'une manche.
   * Sans ce champ, un joueur qui encaisse quinze gorgées au cours d'une partie
   * de Purple verrait son compteur rester à zéro jusqu'au dénouement. Les
   * écrans additionnent donc le total consolidé et cette valeur en cours.
   *
   * Facultatif : certains jeux, comme Le Faux Départ, ne distribuent de
   * gorgées qu'au moment de conclure.
   */
  sips?: Record<PlayerId, number>
  /**
   * Instant limite de la phase courante, en millisecondes serveur.
   * `null` quand la phase n'expire pas. Quand la date est dépassée, n'importe
   * quel client peut réclamer l'action `timeout` ; le serveur revérifie la date
   * avant de l'appliquer. Cela évite un worker de fond tout en garantissant
   * qu'un téléphone verrouillé ne bloque jamais la table.
   */
  deadlineAt: number | null
}

export interface GameState<Pub extends BasePublicState = BasePublicState, Sec = unknown> {
  public: Pub
  secret: Sec
}

export interface InitContext {
  participants: PlayerId[]
  rng: Rng
  now: number
  mode: PlayMode
}

export interface ReduceContext {
  rng: Rng
  now: number
  mode: PlayMode
  /** Auteur de l'action. Le serveur garantit qu'il s'agit d'un participant. */
  actor: PlayerId
}

export interface GameEvent {
  type: string
  [key: string]: unknown
}

export interface GameView {
  /** Diffusé à tous les joueurs de la session. */
  publicView: unknown
  /** Réservé à `viewer`, transitant par la table `player_views`. */
  privateView: unknown
}

export interface ReduceOutcome<S extends GameState = GameState> {
  state: S
  events: GameEvent[]
  /** Présent uniquement quand la manche est terminée. */
  result?: GameResult
}

export interface GameMachine<S extends GameState = GameState, A = unknown> {
  init(ctx: InitContext): S
  /** Jette une `InvalidActionError` si l'action est illégale. */
  reduce(state: S, action: A, ctx: ReduceContext): ReduceOutcome<S>
  view(state: S, viewer: PlayerId): GameView
  /** Valide une charge utile venue du réseau. Jette si elle est malformée. */
  parseAction(raw: unknown): A
}

export interface GameModule<S extends GameState = GameState, A = unknown> {
  definition: GameDefinition
  machine: GameMachine<S, A>
}

/** Forme effacée, stockée dans le registre et manipulée par le serveur. */
export type AnyGameModule = GameModule<GameState<BasePublicState, unknown>, unknown>

/** Action refusée par les règles : le serveur la traduit en HTTP 400. */
export class InvalidActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidActionError'
  }
}

/** Action générique disponible dans tous les jeux quand la phase expire. */
export interface TimeoutAction {
  type: 'timeout'
}

export function emptySips(participants: readonly PlayerId[]): Record<PlayerId, number> {
  const sips: Record<PlayerId, number> = {}
  for (const id of participants) sips[id] = 0
  return sips
}

export function addSips(
  sips: Record<PlayerId, number>,
  player: PlayerId,
  amount: number,
): Record<PlayerId, number> {
  return { ...sips, [player]: (sips[player] ?? 0) + amount }
}

/**
 * Trie des joueurs en classement à ex æquo groupés.
 * `score` : plus c'est grand, mieux c'est.
 */
export function rankByScore(
  players: readonly PlayerId[],
  score: (player: PlayerId) => number,
): PlayerId[][] {
  const groupes = new Map<number, PlayerId[]>()
  for (const player of players) {
    const valeur = score(player)
    const existant = groupes.get(valeur)
    if (existant) existant.push(player)
    else groupes.set(valeur, [player])
  }
  return [...groupes.entries()].sort((a, b) => b[0] - a[0]).map(([, ids]) => ids)
}
