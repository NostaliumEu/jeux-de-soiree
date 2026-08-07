/**
 * Mode Plateau — anneau de 24 cases, à la Mario Party.
 *
 * Pas de dé : c'est le résultat du mini-jeu qui fait avancer. Ce module ne
 * connaît AUCUN jeu : il consomme un `GameResult` normalisé, ce qui lui permet
 * d'accueillir n'importe quel mini-jeu présent ou futur sans une ligne de
 * changement.
 *
 * Les joueurs non sélectionnés parient sur le vainqueur : personne ne regarde
 * sans rien faire, ce qui est la seule façon de tenir un plateau à douze.
 */

import type { Rng } from '@/engine/rng'
import type { GameResult, PlayerId } from '@/engine/types'
import {
  BET_PENALTY_SIPS,
  BET_REWARD_STEPS,
  BOARD_SIZE,
  CELLS,
  GAGES,
  GAINS,
  TOURNEE_SIPS,
} from './cells'

export interface BoardPlayerState {
  id: PlayerId
  position: number
  stars: number
  /** Cases parcourues depuis le début — départage le classement final. */
  distance: number
}

export type BoardPending =
  | { kind: 'tournee'; player: PlayerId; amount: number }
  | { kind: 'duel'; player: PlayerId }

export interface BoardState {
  players: BoardPlayerState[]
  starCell: number
  roundIndex: number
  totalRounds: number
  sips: Record<PlayerId, number>
  /** Effets de case en attente d'une décision humaine. */
  pendings: BoardPending[]
  /** Duel imposé à la manche suivante, produit par une case Duel. */
  forcedDuel: [PlayerId, PlayerId] | null
  log: string[]
  finished: boolean
}

export interface RoundInput {
  participants: PlayerId[]
  result: GameResult
  /** parieur → joueur pronostiqué. Les participants ne parient pas. */
  bets: Record<PlayerId, PlayerId>
}

const LOG_LENGTH = 40

/** La case `target` est-elle franchie ou atteinte en avançant de `steps` ? */
export function crosses(from: number, steps: number, target: number): boolean {
  for (let i = 1; i <= steps; i++) {
    if ((from + i) % BOARD_SIZE === target) return true
  }
  return false
}

function repositionStar(
  players: readonly BoardPlayerState[],
  current: number,
  rng: Rng,
): number {
  const occupees = new Set(players.map((p) => p.position))
  const candidates: number[] = []
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (i !== current && !occupees.has(i)) candidates.push(i)
  }
  if (candidates.length === 0) {
    // Anneau saturé : on se contente de ne pas remettre l'étoile au même endroit.
    const secours = Array.from({ length: BOARD_SIZE }, (_, i) => i).filter((i) => i !== current)
    return rng.pick(secours)
  }
  return rng.pick(candidates)
}

export function initBoard(
  playerIds: readonly PlayerId[],
  totalRounds: number,
  rng: Rng,
): BoardState {
  if (playerIds.length < 2) throw new Error('Le plateau exige au moins deux joueurs.')
  if (totalRounds < 1) throw new Error('Il faut au moins une manche.')

  const sips: Record<PlayerId, number> = {}
  for (const id of playerIds) sips[id] = 0

  return {
    players: playerIds.map((id) => ({ id, position: 0, stars: 0, distance: 0 })),
    starCell: rng.intRange(1, BOARD_SIZE - 1),
    roundIndex: 0,
    totalRounds,
    sips,
    pendings: [],
    forcedDuel: null,
    log: [],
    finished: false,
  }
}

export function applyRound(state: BoardState, input: RoundInput, rng: Rng): BoardState {
  if (state.finished) throw new Error('La partie est terminée.')
  if (state.pendings.length > 0) {
    throw new Error('Un effet de case attend encore une décision.')
  }

  const players = state.players.map((p) => ({ ...p }))
  const byId = new Map(players.map((p) => [p.id, p]))
  const sips = { ...state.sips }
  const journal: string[] = []
  const pendings: BoardPending[] = []
  let starCell = state.starCell

  for (const [id, montant] of Object.entries(input.result.sips)) {
    if (montant > 0) sips[id] = (sips[id] ?? 0) + montant
  }

  const vainqueurs = input.result.ranking[0] ?? []
  // Une case Duel programme un affrontement pour la manche suivante. Sur la
  // dernière, il n'y en aura pas : inutile de faire choisir un adversaire pour
  // un duel qui n'aura jamais lieu.
  const derniereManche = state.roundIndex + 1 >= state.totalRounds

  const pas = new Map<PlayerId, number>()
  input.result.ranking.forEach((groupe, rang) => {
    const gain = GAINS[rang] ?? 0
    for (const id of groupe) pas.set(id, gain)
  })

  // Les paris : seuls les non-participants y ont droit.
  const parieurs = Object.keys(input.bets)
    .filter((id) => !input.participants.includes(id))
    .sort()

  for (const parieur of parieurs) {
    const pronostic = input.bets[parieur]
    if (pronostic === undefined) continue
    if (vainqueurs.includes(pronostic)) {
      pas.set(parieur, (pas.get(parieur) ?? 0) + BET_REWARD_STEPS)
      journal.push(`Pari gagné : ${parieur} avance de ${BET_REWARD_STEPS}.`)
    } else {
      sips[parieur] = (sips[parieur] ?? 0) + BET_PENALTY_SIPS
      journal.push(`Pari perdu : ${parieur} boit ${BET_PENALTY_SIPS}.`)
    }
  }

  // Ordre déterministe : les mieux classés bougent d'abord, donc ramassent
  // l'étoile en priorité s'ils passent dessus.
  const ordre = [...input.result.ranking.flat(), ...parieurs]

  for (const id of ordre) {
    const pion = byId.get(id)
    const avance = pas.get(id) ?? 0
    if (!pion || avance <= 0) continue

    const depart = pion.position
    pion.position = (depart + avance) % BOARD_SIZE
    pion.distance += avance

    if (crosses(depart, avance, starCell)) {
      pion.stars += 1
      journal.push(`⭐ ${id} ramasse une étoile.`)
      starCell = repositionStar(players, starCell, rng)
    }

    switch (CELLS[pion.position]) {
      case 'gage':
        journal.push(`Gage pour ${id} : ${rng.pick(GAGES)}`)
        break
      case 'tournee':
        pendings.push({ kind: 'tournee', player: id, amount: TOURNEE_SIPS })
        break
      case 'duel':
        if (derniereManche) {
          journal.push(`⚔️ ${id} tombe sur un Duel, mais la partie s’arrête ici.`)
        } else {
          pendings.push({ kind: 'duel', player: id })
        }
        break
      case 'teleport': {
        const autres = players.filter((p) => p.id !== id)
        if (autres.length > 0) {
          const cible = rng.pick(autres)
          const memoire = pion.position
          pion.position = cible.position
          cible.position = memoire
          journal.push(`🌀 ${id} échange sa place avec ${cible.id}.`)
        }
        break
      }
      case 'neutre':
      case undefined:
        break
    }
  }

  const roundIndex = state.roundIndex + 1

  return {
    ...state,
    players,
    starCell,
    sips,
    pendings,
    forcedDuel: null,
    roundIndex,
    finished: roundIndex >= state.totalRounds,
    log: [...state.log, ...journal].slice(-LOG_LENGTH),
  }
}

/** Le joueur tombé sur une Tournée répartit ses gorgées comme il l'entend. */
export function resolveTournee(
  state: BoardState,
  player: PlayerId,
  distribution: Record<PlayerId, number>,
): BoardState {
  const attente = state.pendings.find((p) => p.kind === 'tournee' && p.player === player)
  if (!attente || attente.kind !== 'tournee') {
    throw new Error('Aucune tournée en attente pour ce joueur.')
  }

  const connus = new Set(state.players.map((p) => p.id))
  let total = 0
  for (const [cible, montant] of Object.entries(distribution)) {
    if (!connus.has(cible)) throw new Error(`Joueur inconnu : ${cible}`)
    if (!Number.isInteger(montant) || montant < 0) throw new Error('Répartition invalide.')
    total += montant
  }
  if (total !== attente.amount) {
    throw new Error(`Il faut distribuer exactement ${attente.amount} gorgées.`)
  }

  const sips = { ...state.sips }
  for (const [cible, montant] of Object.entries(distribution)) {
    if (montant > 0) sips[cible] = (sips[cible] ?? 0) + montant
  }

  return {
    ...state,
    sips,
    pendings: state.pendings.filter((p) => p !== attente),
    log: [...state.log, `🍻 ${player} distribue ${attente.amount} gorgées.`].slice(-LOG_LENGTH),
  }
}

/** Le joueur tombé sur une case Duel désigne son adversaire. */
export function resolveDuel(
  state: BoardState,
  player: PlayerId,
  opponent: PlayerId,
): BoardState {
  const attente = state.pendings.find((p) => p.kind === 'duel' && p.player === player)
  if (!attente) throw new Error('Aucun duel en attente pour ce joueur.')
  if (opponent === player) throw new Error('On ne se défie pas soi-même.')
  if (!state.players.some((p) => p.id === opponent)) throw new Error(`Joueur inconnu : ${opponent}`)

  return {
    ...state,
    pendings: state.pendings.filter((p) => p !== attente),
    forcedDuel: [player, opponent],
    log: [...state.log, `⚔️ ${player} défie ${opponent}.`].slice(-LOG_LENGTH),
  }
}

/** Classement : étoiles d'abord, distance parcourue en départage. */
export function standings(state: BoardState): PlayerId[][] {
  const score = (p: BoardPlayerState): number => p.stars * 10_000 + p.distance

  const groupes = new Map<number, PlayerId[]>()
  for (const joueur of state.players) {
    const valeur = score(joueur)
    const existant = groupes.get(valeur)
    if (existant) existant.push(joueur.id)
    else groupes.set(valeur, [joueur.id])
  }

  return [...groupes.entries()].sort((a, b) => b[0] - a[0]).map(([, ids]) => ids)
}
