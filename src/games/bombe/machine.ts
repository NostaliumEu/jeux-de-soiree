/**
 * La Bombe — patate chaude.
 *
 * On se passe la bombe en tapant sur son écran. Elle est armée pour exploser à
 * un instant tiré au sort, connu du seul serveur : celui qui la tient à ce
 * moment-là encaisse.
 *
 * L'instant exact vit dans l'état secret, mais la borne haute est publique et
 * sert de date limite de phase. C'est ce qui garantit que la bombe finit
 * toujours par partir, même si son porteur se contente d'attendre en espérant
 * s'en tirer : au pire elle lui explose entre les mains à l'échéance.
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
import { BOMBE_MAX_MS, BOMBE_MIN_MS, BOMBE_ROUNDS, BOMBE_SIPS } from './definition'

export interface Explosion {
  round: number
  victim: PlayerId
  amount: number
}

export interface BombePublic extends BasePublicState {
  phase: 'passe' | 'over'
  order: PlayerId[]
  holderIndex: number
  round: number
  passes: Record<PlayerId, number>
  explosions: Record<PlayerId, number>
  sips: Record<PlayerId, number>
  history: Explosion[]
  /** Instant serveur où la bombe a été armée : sert à l'animation du client. */
  armedAt: number
}

export interface BombeSecret {
  explodeAt: number
}

export type BombeState = GameState<BombePublic, BombeSecret>

export const bombeActionSchema = z.union([
  z.object({ type: z.literal('pass') }),
  z.object({ type: z.literal('timeout') }),
])

export type BombeAction = z.infer<typeof bombeActionSchema>

function zeroed(ids: readonly PlayerId[]): Record<PlayerId, number> {
  return Object.fromEntries(ids.map((id) => [id, 0]))
}

function porteur(pub: BombePublic): PlayerId {
  const id = pub.order[pub.holderIndex]
  if (id === undefined) throw new Error('Porteur introuvable')
  return id
}

function armer(now: number, rng: Rng): { explodeAt: number; deadlineAt: number; armedAt: number } {
  return {
    explodeAt: now + rng.intRange(BOMBE_MIN_MS, BOMBE_MAX_MS),
    // Borne haute publique : la bombe ne peut pas traîner au-delà.
    deadlineAt: now + BOMBE_MAX_MS,
    armedAt: now,
  }
}

function buildResult(pub: BombePublic): GameResult {
  // Le moins souvent touché d'abord ; à égalité, celui qui a le plus fait
  // circuler la bombe. Rester passif ne doit pas être payant.
  const score = (id: PlayerId) => -(pub.explosions[id] ?? 0) * 1_000 + (pub.passes[id] ?? 0)

  const groupes = new Map<number, PlayerId[]>()
  for (const id of pub.order) {
    const valeur = score(id)
    groupes.set(valeur, [...(groupes.get(valeur) ?? []), id])
  }

  return {
    ranking: [...groupes.entries()].sort((a, b) => b[0] - a[0]).map(([, ids]) => ids),
    sips: { ...pub.sips },
  }
}

/** Fait exploser la bombe sur son porteur et arme la manche suivante. */
function exploser(pub: BombePublic, victime: PlayerId, now: number, rng: Rng): ReduceOutcome<BombeState> {
  const degats = BOMBE_SIPS[pub.round - 1] ?? BOMBE_SIPS[BOMBE_SIPS.length - 1] ?? 2
  const explosion: Explosion = { round: pub.round, victim: victime, amount: degats }

  const termine = pub.round >= BOMBE_ROUNDS
  const suivante = armer(now, rng)

  // La victime repart avec la bombe : c'est la règle de la cour de récré.
  const nouveau: BombePublic = {
    ...pub,
    phase: termine ? 'over' : 'passe',
    deadlineAt: termine ? null : suivante.deadlineAt,
    armedAt: termine ? pub.armedAt : suivante.armedAt,
    round: pub.round + 1,
    holderIndex: pub.order.indexOf(victime),
    explosions: { ...pub.explosions, [victime]: (pub.explosions[victime] ?? 0) + 1 },
    sips: { ...pub.sips, [victime]: (pub.sips[victime] ?? 0) + degats },
    history: [...pub.history, explosion],
  }

  return {
    state: { public: nouveau, secret: { explodeAt: suivante.explodeAt } },
    events: [{ type: 'boom', ...explosion }],
    ...(termine ? { result: buildResult(nouveau) } : {}),
  }
}

export const bombeMachine: GameMachine<BombeState, BombeAction> = {
  init(ctx) {
    const order = [...ctx.participants]
    if (order.length < 3) throw new Error('La Bombe exige au moins trois joueurs.')

    const amorce = armer(ctx.now, ctx.rng)

    return {
      public: {
        phase: 'passe',
        deadlineAt: amorce.deadlineAt,
        armedAt: amorce.armedAt,
        order,
        holderIndex: 0,
        round: 1,
        passes: zeroed(order),
        explosions: zeroed(order),
        sips: zeroed(order),
        history: [],
      },
      secret: { explodeAt: amorce.explodeAt },
    }
  },

  parseAction(raw) {
    return bombeActionSchema.parse(raw)
  },

  reduce(state, action, ctx): ReduceOutcome<BombeState> {
    const pub = state.public

    if (pub.phase === 'over') {
      throw new InvalidActionError('La manche est terminée.')
    }

    const tenant = porteur(pub)

    if (action.type === 'timeout') {
      if (pub.deadlineAt === null || ctx.now < pub.deadlineAt) {
        throw new InvalidActionError('La bombe n’a pas encore atteint sa limite.')
      }
      return exploser(pub, tenant, ctx.now, ctx.rng)
    }

    if (ctx.actor !== tenant) {
      throw new InvalidActionError('Tu n’as pas la bombe.')
    }

    // Passer trop tard, c'est se la prendre : le compte à rebours était déjà à
    // zéro au moment où le joueur a tapé.
    if (ctx.now >= state.secret.explodeAt) {
      return exploser(pub, tenant, ctx.now, ctx.rng)
    }

    const suivant: BombePublic = {
      ...pub,
      holderIndex: (pub.holderIndex + 1) % pub.order.length,
      passes: { ...pub.passes, [tenant]: (pub.passes[tenant] ?? 0) + 1 },
    }

    return {
      state: { public: suivant, secret: state.secret },
      events: [{ type: 'pass', from: tenant }],
    }
  },

  view(state) {
    // Rien de personnel ici : l'instant de l'explosion est caché à TOUT le
    // monde, y compris à celui qui tient la bombe.
    return { publicView: state.public, privateView: null }
  },
}
