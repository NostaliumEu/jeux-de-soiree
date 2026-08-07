/**
 * Le Sprint — course de matraquage.
 *
 * Chacun tape sur son écran pour remplir une jauge ; le premier à la remplir
 * gagne, le dernier trinque.
 *
 * Deux contraintes façonnent ce jeu :
 *
 * 1. Un envoi réseau par tap saturerait tout. Le client compte ses coups en
 *    local et les envoie par paquets ; la machine ne voit donc jamais un tap,
 *    seulement un nombre.
 * 2. Puisqu'elle reçoit un nombre annoncé par le client, elle ne peut pas le
 *    croire sur parole. La progression est bornée par ce qu'un pouce humain
 *    peut produire dans le temps écoulé : annoncer soixante coups d'un seul
 *    envoi ne remplit pas la jauge.
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
import {
  SPRINT_COUNTDOWN_MS,
  SPRINT_LIMIT_MS,
  SPRINT_MAX_BATCH,
  SPRINT_MAX_PAR_SECONDE,
  SPRINT_SIPS,
  SPRINT_TARGET,
} from './definition'

export interface SprintPublic extends BasePublicState {
  phase: 'course' | 'over'
  participants: PlayerId[]
  /** Instant serveur du départ : avant, les coups ne comptent pas. */
  startsAt: number
  target: number
  progress: Record<PlayerId, number>
  /** Ordre d'arrivée, au fur et à mesure. */
  finishers: PlayerId[]
  sips: Record<PlayerId, number>
}

export type SprintState = GameState<SprintPublic, Record<string, never>>

export const sprintActionSchema = z.union([
  z.object({ type: z.literal('taps'), count: z.number().int().min(1).max(SPRINT_MAX_BATCH) }),
  z.object({ type: z.literal('timeout') }),
])

export type SprintAction = z.infer<typeof sprintActionSchema>

function zeroed(ids: readonly PlayerId[]): Record<PlayerId, number> {
  return Object.fromEntries(ids.map((id) => [id, 0]))
}

/** Plafond de coups crédibles depuis le départ. */
export function plafondCredible(startsAt: number, now: number): number {
  const ecouleMs = Math.max(0, now - startsAt)
  // La marge absorbe les paquets en vol et les horloges légèrement décalées.
  return Math.ceil((ecouleMs / 1_000) * SPRINT_MAX_PAR_SECONDE) + SPRINT_MAX_BATCH
}

function buildResult(pub: SprintPublic): GameResult {
  // Les arrivés d'abord, dans leur ordre d'arrivée ; les autres ensuite, selon
  // le remplissage de leur jauge.
  const restants = pub.participants.filter((id) => !pub.finishers.includes(id))
  const parJauge = new Map<number, PlayerId[]>()
  for (const id of restants) {
    const p = pub.progress[id] ?? 0
    parJauge.set(p, [...(parJauge.get(p) ?? []), id])
  }

  const ranking: PlayerId[][] = [
    ...pub.finishers.map((id) => [id]),
    ...[...parJauge.entries()].sort((a, b) => b[0] - a[0]).map(([, ids]) => ids),
  ]

  const sips: Record<PlayerId, number> = {}
  ranking.forEach((groupe, rang) => {
    const montant = SPRINT_SIPS[Math.min(rang, SPRINT_SIPS.length - 1)] ?? 0
    for (const id of groupe) sips[id] = montant
  })

  return { ranking, sips }
}

export const sprintMachine: GameMachine<SprintState, SprintAction> = {
  init(ctx) {
    const participants = [...ctx.participants]
    if (participants.length < 2) throw new Error('Le Sprint exige au moins deux joueurs.')

    const startsAt = ctx.now + SPRINT_COUNTDOWN_MS

    return {
      public: {
        phase: 'course',
        startsAt,
        deadlineAt: startsAt + SPRINT_LIMIT_MS,
        participants,
        target: SPRINT_TARGET,
        progress: zeroed(participants),
        finishers: [],
        sips: zeroed(participants),
      },
      secret: {},
    }
  },

  parseAction(raw) {
    return sprintActionSchema.parse(raw)
  },

  reduce(state, action, ctx): ReduceOutcome<SprintState> {
    const pub = state.public

    if (pub.phase === 'over') {
      throw new InvalidActionError('La course est terminée.')
    }

    if (action.type === 'timeout') {
      if (pub.deadlineAt === null || ctx.now < pub.deadlineAt) {
        throw new InvalidActionError('La course n’est pas encore finie.')
      }
      const clos: SprintPublic = { ...pub, phase: 'over', deadlineAt: null }
      const resultat = buildResult(clos)
      return {
        state: { public: { ...clos, sips: resultat.sips }, secret: state.secret },
        events: [{ type: 'timeout' }],
        result: resultat,
      }
    }

    if (!pub.participants.includes(ctx.actor)) {
      throw new InvalidActionError('Tu ne participes pas à cette course.')
    }
    if (ctx.now < pub.startsAt) {
      throw new InvalidActionError('Le départ n’a pas encore été donné.')
    }
    if (pub.finishers.includes(ctx.actor)) {
      throw new InvalidActionError('Ta jauge est déjà pleine.')
    }

    const plafond = Math.min(plafondCredible(pub.startsAt, ctx.now), pub.target)
    const avance = Math.min((pub.progress[ctx.actor] ?? 0) + action.count, plafond)

    const progress = { ...pub.progress, [ctx.actor]: avance }
    const arrive = avance >= pub.target
    const finishers = arrive ? [...pub.finishers, ctx.actor] : pub.finishers

    // La course s'arrête dès qu'il ne reste plus personne à départager.
    const termine = finishers.length >= pub.participants.length - 1 && finishers.length > 0

    const suivant: SprintPublic = {
      ...pub,
      progress,
      finishers,
      phase: termine ? 'over' : 'course',
      deadlineAt: termine ? null : pub.deadlineAt,
    }

    if (!termine) {
      return {
        state: { public: suivant, secret: state.secret },
        events: arrive ? [{ type: 'finish', player: ctx.actor }] : [],
      }
    }

    const resultat = buildResult(suivant)
    return {
      state: { public: { ...suivant, sips: resultat.sips }, secret: state.secret },
      events: [{ type: 'finish', player: ctx.actor }],
      result: resultat,
    }
  },

  view(state) {
    return { publicView: state.public, privateView: null }
  },
}
