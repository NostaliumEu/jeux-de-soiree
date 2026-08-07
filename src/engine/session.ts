/**
 * Cycle de vie d'une session : code d'invitation, choix du mini-jeu et
 * sélection équitable des participants.
 */

import { shuffle, type Rng } from './rng'
import { GAMES } from './registry'
import type { AnyGameModule, GameDefinition, GameFormat, PlayerId } from './types'

/** 32 symboles, sans I/1 ni O/0 : un code se dicte à voix haute sans ambiguïté. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 4
/** Plafond technique, pour maîtriser le coût temps réel si le lien circule. */
export const MAX_PLAYERS_PER_SESSION = 30
/** Au-delà de 60 s de silence, l'hôte est considéré parti. */
export const HOST_HANDOVER_MS = 60_000

export function generateCode(rng: Rng): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET.charAt(rng.intRange(0, CODE_ALPHABET.length - 1))
  }
  return code
}

export function isValidCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false
  return [...code].every((c) => CODE_ALPHABET.includes(c))
}

export function eligibleGames(playerCount: number, boardOnly: boolean): AnyGameModule[] {
  return GAMES.filter((g) => {
    if (playerCount < g.definition.minPlayers) return false
    if (boardOnly && !g.definition.supportsBoard) return false
    return true
  })
}

/**
 * Tire un mini-jeu jouable avec l'effectif présent, en évitant de proposer
 * deux fois de suite le même — sauf s'il est le seul éligible.
 */
export function pickGame(
  playerCount: number,
  lastKey: string | null,
  rng: Rng,
  boardOnly = false,
): AnyGameModule {
  const eligibles = eligibleGames(playerCount, boardOnly)
  if (eligibles.length === 0) {
    throw new Error(`Aucun jeu jouable à ${playerCount} joueurs.`)
  }
  const sansRepetition = eligibles.filter((g) => g.definition.key !== lastKey)
  return rng.pick(sansRepetition.length > 0 ? sansRepetition : eligibles)
}

export function pickFormat(definition: GameDefinition, rng: Rng): GameFormat {
  return rng.pick(definition.formats)
}

/**
 * Ordonne les joueurs du moins sollicité au plus sollicité, en brassant les
 * ex æquo. Personne ne doit rester spectateur toute la soirée sous prétexte
 * que le hasard l'a oublié.
 */
function fairOrder(
  players: readonly PlayerId[],
  participation: Record<PlayerId, number>,
  rng: Rng,
): PlayerId[] {
  // `sort` est stable : brasser d'abord suffit à départager les ex æquo au hasard.
  return shuffle(players, rng).sort(
    (a, b) => (participation[a] ?? 0) - (participation[b] ?? 0),
  )
}

export function pickParticipants(
  players: readonly PlayerId[],
  format: GameFormat,
  definition: GameDefinition,
  participation: Record<PlayerId, number>,
  rng: Rng,
): PlayerId[] {
  const ordonnes = fairOrder(players, participation, rng)
  const plafond = definition.maxPlayers ?? players.length

  switch (format) {
    case 'duel':
      if (players.length < 2) throw new Error('Un duel exige deux joueurs.')
      return ordonnes.slice(0, 2)

    case 'asymetrique': {
      if (players.length < 3) throw new Error('Un jeu asymétrique exige trois joueurs.')
      const total = Math.min(players.length, plafond)
      return ordonnes.slice(0, total)
    }

    case 'tous':
    case 'tour-par-tour':
      return ordonnes.slice(0, Math.min(players.length, plafond))
  }
}
