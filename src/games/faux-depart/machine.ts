/**
 * Le Faux Départ — duel de réflexe au meilleur des trois essais.
 *
 * Le piège de ce jeu est réseau, pas gameplay. Si le serveur envoyait le signal
 * « vert » et que celui d'un joueur arrivait 200 ms après celui de l'autre, le
 * duel serait décidé par la qualité de la connexion et non par les réflexes.
 *
 * D'où le rendez-vous horaire : chaque client mesure son décalage d'horloge
 * avec le serveur, le serveur annonce à l'avance « le vert s'allume à l'instant
 * serveur T », chaque téléphone l'affiche localement au bon moment et mesure
 * SON PROPRE écart. On ne compare donc jamais des heures d'arrivée réseau, mais
 * des temps de réaction.
 *
 * Contrepartie assumée : puisque l'instant du vert est connu du navigateur à
 * l'avance, quelqu'un qui ouvre les outils de développement peut le lire. Le
 * plancher humain de {@link FD_HUMAN_FLOOR_MS} ferme la triche grossière ; le
 * reste relève de la confiance entre amis, ce qui est le cadre de ce jeu.
 */

import { z } from 'zod'
import {
  InvalidActionError,
  type BasePublicState,
  type GameMachine,
  type GameResult,
  type GameState,
  type PlayerId,
  type ReduceOutcome,
} from '@/engine/types'
import type { Rng } from '@/engine/rng'
import {
  FD_HUMAN_FLOOR_MS,
  FD_MAX_DELAY_MS,
  FD_MIN_DELAY_MS,
  FD_PAUSE_MS,
  FD_REACTION_WINDOW_MS,
  FD_SIPS,
  FD_SIPS_FALSE_START,
  FD_WINS_NEEDED,
} from './definition'

export interface FauxDepartTap {
  /** Écart au vert : négatif = faux départ, positif = temps de réaction. */
  offsetMs: number
  falseStart: boolean
}

export interface FauxDepartAttempt {
  attempt: number
  winner: PlayerId | null
  loser: PlayerId | null
  falseStart: boolean
  taps: Record<PlayerId, FauxDepartTap>
}

export interface FauxDepartPublic extends BasePublicState {
  phase: 'arming' | 'over'
  duellists: PlayerId[]
  wins: Record<PlayerId, number>
  attempt: number
  /** Instant serveur auquel le vert s'allume. */
  greenAt: number
  taps: Record<PlayerId, FauxDepartTap>
  history: FauxDepartAttempt[]
  /** Le dernier essai décisif a-t-il été perdu sur un faux départ. */
  decidedByFalseStart: boolean
  /**
   * Contrairement aux autres jeux, rien ne se boit avant le dénouement : ce
   * compteur reste à zéro jusqu'au dernier essai. Il n'en est pas moins
   * nécessaire, sinon les écrans n'auraient aucun moyen d'annoncer la sanction.
   */
  sips: Record<PlayerId, number>
}

export type FauxDepartState = GameState<FauxDepartPublic, Record<string, never>>

export const fauxDepartActionSchema = z.union([
  z.object({ type: z.literal('tap'), offsetMs: z.number().finite() }),
  z.object({ type: z.literal('timeout') }),
])

export type FauxDepartAction = z.infer<typeof fauxDepartActionSchema>

function nextGreen(now: number, rng: Rng): number {
  return now + FD_PAUSE_MS + rng.intRange(FD_MIN_DELAY_MS, FD_MAX_DELAY_MS)
}

function classify(offsetMs: number): FauxDepartTap {
  // Taper avant le vert, ou plus vite qu'un humain, revient au même : faux départ.
  const falseStart = offsetMs < FD_HUMAN_FLOOR_MS
  return { offsetMs, falseStart }
}

/** Départage un essai. `null` = personne ne l'emporte, on rejoue. */
function judge(
  duellists: PlayerId[],
  taps: Record<PlayerId, FauxDepartTap | undefined>,
): { winner: PlayerId | null; loser: PlayerId | null; falseStart: boolean } {
  const [un, deux] = duellists
  if (un === undefined || deux === undefined) throw new Error('Le duel exige deux joueurs')

  const a = taps[un]
  const b = taps[deux]

  // Personne n'a tapé dans la fenêtre : essai nul, on recommence.
  if (!a && !b) return { winner: null, loser: null, falseStart: false }
  if (!a) return { winner: deux, loser: un, falseStart: false }
  if (!b) return { winner: un, loser: deux, falseStart: false }

  if (a.falseStart && b.falseStart) {
    // Double faux départ : celui qui a tapé le plus tôt perd.
    if (a.offsetMs === b.offsetMs) return { winner: null, loser: null, falseStart: true }
    return a.offsetMs < b.offsetMs
      ? { winner: deux, loser: un, falseStart: true }
      : { winner: un, loser: deux, falseStart: true }
  }

  if (a.falseStart) return { winner: deux, loser: un, falseStart: true }
  if (b.falseStart) return { winner: un, loser: deux, falseStart: true }

  if (a.offsetMs === b.offsetMs) return { winner: null, loser: null, falseStart: false }
  return a.offsetMs < b.offsetMs
    ? { winner: un, loser: deux, falseStart: false }
    : { winner: deux, loser: un, falseStart: false }
}

function buildResult(pub: FauxDepartPublic): GameResult {
  const [un, deux] = pub.duellists
  if (un === undefined || deux === undefined) throw new Error('Le duel exige deux joueurs')

  const winsUn = pub.wins[un] ?? 0
  const winsDeux = pub.wins[deux] ?? 0
  const vainqueur = winsUn >= winsDeux ? un : deux
  const perdant = vainqueur === un ? deux : un
  const gorgees = pub.decidedByFalseStart ? FD_SIPS_FALSE_START : FD_SIPS

  return {
    ranking: [[vainqueur], [perdant]],
    sips: { [vainqueur]: 0, [perdant]: gorgees },
  }
}

export const fauxDepartMachine: GameMachine<FauxDepartState, FauxDepartAction> = {
  init(ctx) {
    const duellists = [...ctx.participants]
    if (duellists.length !== 2) {
      throw new Error('Le Faux Départ se joue exactement à deux.')
    }
    const greenAt = nextGreen(ctx.now, ctx.rng)
    const wins: Record<PlayerId, number> = {}
    for (const id of duellists) wins[id] = 0

    return {
      public: {
        phase: 'arming',
        deadlineAt: greenAt + FD_REACTION_WINDOW_MS,
        duellists,
        wins,
        attempt: 1,
        greenAt,
        taps: {},
        history: [],
        decidedByFalseStart: false,
        sips: Object.fromEntries(duellists.map((id) => [id, 0])),
      },
      secret: {},
    }
  },

  parseAction(raw) {
    return fauxDepartActionSchema.parse(raw)
  },

  reduce(state, action, ctx): ReduceOutcome<FauxDepartState> {
    const pub = state.public

    if (pub.phase === 'over') {
      throw new InvalidActionError('Le duel est terminé.')
    }

    let taps: Record<PlayerId, FauxDepartTap> = pub.taps

    if (action.type === 'tap') {
      if (!pub.duellists.includes(ctx.actor)) {
        throw new InvalidActionError('Tu n’es pas dans ce duel.')
      }
      if (pub.taps[ctx.actor]) {
        throw new InvalidActionError('Tu as déjà tapé sur cet essai.')
      }
      taps = { ...pub.taps, [ctx.actor]: classify(action.offsetMs) }

      // On attend le second duelliste.
      if (Object.keys(taps).length < pub.duellists.length) {
        return {
          state: { public: { ...pub, taps }, secret: state.secret },
          events: [{ type: 'tapped', player: ctx.actor }],
        }
      }
    } else {
      if (pub.deadlineAt === null || ctx.now < pub.deadlineAt) {
        throw new InvalidActionError('L’essai n’a pas encore expiré.')
      }
    }

    const verdict = judge(pub.duellists, taps)

    const essai: FauxDepartAttempt = {
      attempt: pub.attempt,
      winner: verdict.winner,
      loser: verdict.loser,
      falseStart: verdict.falseStart,
      taps,
    }

    const wins = verdict.winner
      ? { ...pub.wins, [verdict.winner]: (pub.wins[verdict.winner] ?? 0) + 1 }
      : pub.wins

    const termine = verdict.winner !== null && (wins[verdict.winner] ?? 0) >= FD_WINS_NEEDED

    let nextPublic: FauxDepartPublic
    if (termine) {
      const clos: FauxDepartPublic = {
        ...pub,
        phase: 'over',
        deadlineAt: null,
        wins,
        taps,
        history: [...pub.history, essai],
        decidedByFalseStart: verdict.falseStart,
      }
      // La sanction ne se connaît qu'une fois le duel tranché.
      nextPublic = { ...clos, sips: buildResult(clos).sips }
    } else {
      // Un seul tirage : `greenAt` et la date limite doivent décrire le même essai.
      const greenAt = nextGreen(ctx.now, ctx.rng)
      nextPublic = {
        ...pub,
        wins,
        attempt: pub.attempt + 1,
        greenAt,
        taps: {},
        history: [...pub.history, essai],
        deadlineAt: greenAt + FD_REACTION_WINDOW_MS,
      }
    }

    return {
      state: { public: nextPublic, secret: state.secret },
      events: [{ type: 'attempt', ...essai }],
      ...(termine ? { result: buildResult(nextPublic) } : {}),
    }
  },

  view(state, viewer) {
    return {
      publicView: state.public,
      privateView: { myTap: state.public.taps[viewer] ?? null },
    }
  },
}
