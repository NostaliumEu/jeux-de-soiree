/**
 * Le Gardien — choix simultanés cachés puis révélation synchronisée.
 *
 * Un gardien contre deux à cinq tireurs, sur trois manches. À chaque manche
 * tout le monde choisit en secret : les tireurs un coin, le gardien celui où il
 * plonge. Tous les tirs partis dans le coin du gardien sont arrêtés.
 *
 * Les choix ne quittent jamais le serveur avant la révélation : ils vivent dans
 * l'état secret, et `view` ne rend à chaque joueur que le sien. C'est le patron
 * réutilisable pour tous les futurs jeux à information cachée — pierre-feuille-
 * ciseaux, enchères, paris.
 */

import { z } from 'zod'
import {
  InvalidActionError,
  rankByScore,
  type BasePublicState,
  type GameMachine,
  type GameResult,
  type GameState,
  type PlayerId,
  type ReduceOutcome,
} from '@/engine/types'
import { GARDIEN_CHOOSE_TIMEOUT_MS, GARDIEN_ROUNDS, GARDIEN_SIPS_PER_EVENT } from './definition'

export type Corner = 'HG' | 'HD' | 'BG' | 'BD' | 'C'

export const CORNERS: readonly Corner[] = ['HG', 'HD', 'BG', 'BD', 'C']

export const CORNER_LABELS: Record<Corner, string> = {
  HG: 'Lucarne gauche',
  HD: 'Lucarne droite',
  BG: 'Bas gauche',
  BD: 'Bas droite',
  C: 'Plein centre',
}

export interface GardienShot {
  shooter: PlayerId
  corner: Corner
  saved: boolean
}

export interface GardienRoundReveal {
  round: number
  keeperCorner: Corner
  shots: GardienShot[]
}

export interface GardienPublic extends BasePublicState {
  phase: 'choose' | 'over'
  keeper: PlayerId
  shooters: PlayerId[]
  round: number
  /** Qui a déjà choisi — sans révéler quoi. */
  chosen: PlayerId[]
  points: Record<PlayerId, number>
  sips: Record<PlayerId, number>
  history: GardienRoundReveal[]
}

export interface GardienSecret {
  choices: Record<PlayerId, Corner>
}

export type GardienState = GameState<GardienPublic, GardienSecret>

export const gardienActionSchema = z.union([
  z.object({ type: z.literal('choose'), corner: z.enum(['HG', 'HD', 'BG', 'BD', 'C']) }),
  z.object({ type: z.literal('timeout') }),
])

export type GardienAction = z.infer<typeof gardienActionSchema>

function participantsOf(pub: GardienPublic): PlayerId[] {
  return [pub.keeper, ...pub.shooters]
}

function zeroed(ids: readonly PlayerId[]): Record<PlayerId, number> {
  const out: Record<PlayerId, number> = {}
  for (const id of ids) out[id] = 0
  return out
}

function buildResult(pub: GardienPublic): GameResult {
  return {
    ranking: rankByScore(participantsOf(pub), (id) => pub.points[id] ?? 0),
    sips: { ...pub.sips },
  }
}

export const gardienMachine: GameMachine<GardienState, GardienAction> = {
  init(ctx) {
    const [keeper, ...shooters] = ctx.participants
    if (keeper === undefined || shooters.length < 2) {
      throw new Error('Le Gardien exige un gardien et au moins deux tireurs.')
    }

    return {
      public: {
        phase: 'choose',
        deadlineAt: ctx.now + GARDIEN_CHOOSE_TIMEOUT_MS,
        keeper,
        shooters,
        round: 1,
        chosen: [],
        points: zeroed(ctx.participants),
        sips: zeroed(ctx.participants),
        history: [],
      },
      secret: { choices: {} },
    }
  },

  parseAction(raw) {
    return gardienActionSchema.parse(raw)
  },

  reduce(state, action, ctx): ReduceOutcome<GardienState> {
    const pub = state.public

    if (pub.phase === 'over') {
      throw new InvalidActionError('La partie est terminée.')
    }

    const participants = participantsOf(pub)
    let choices: Record<PlayerId, Corner> = { ...state.secret.choices }
    let chosen = [...pub.chosen]

    if (action.type === 'choose') {
      if (!participants.includes(ctx.actor)) {
        throw new InvalidActionError('Tu ne participes pas à ce mini-jeu.')
      }
      if (chosen.includes(ctx.actor)) {
        throw new InvalidActionError('Tu as déjà choisi sur cette manche.')
      }
      choices[ctx.actor] = action.corner
      chosen = [...chosen, ctx.actor]

      // On attend que tout le monde ait choisi : la révélation est simultanée.
      if (chosen.length < participants.length) {
        return {
          state: { public: { ...pub, chosen }, secret: { choices } },
          events: [{ type: 'chosen', player: ctx.actor }],
        }
      }
    } else {
      if (pub.deadlineAt === null || ctx.now < pub.deadlineAt) {
        throw new InvalidActionError('La manche n’a pas encore expiré.')
      }
      // Les absents tirent au hasard plutôt que de bloquer la table.
      for (const id of participants) {
        if (!chosen.includes(id)) {
          choices = { ...choices, [id]: ctx.rng.pick(CORNERS) }
          chosen = [...chosen, id]
        }
      }
    }

    const keeperCorner = choices[pub.keeper]
    if (keeperCorner === undefined) throw new Error('Le gardien n’a pas de choix enregistré')

    const shots: GardienShot[] = pub.shooters.map((shooter) => {
      const corner = choices[shooter]
      if (corner === undefined) throw new Error(`Tireur sans choix : ${shooter}`)
      return { shooter, corner, saved: corner === keeperCorner }
    })

    const arrets = shots.filter((s) => s.saved).length
    const buts = shots.length - arrets

    const points = { ...pub.points }
    const sips = { ...pub.sips }

    points[pub.keeper] = (points[pub.keeper] ?? 0) + arrets
    sips[pub.keeper] = (sips[pub.keeper] ?? 0) + buts * GARDIEN_SIPS_PER_EVENT

    for (const shot of shots) {
      if (shot.saved) {
        sips[shot.shooter] = (sips[shot.shooter] ?? 0) + GARDIEN_SIPS_PER_EVENT
      } else {
        points[shot.shooter] = (points[shot.shooter] ?? 0) + 1
      }
    }

    const reveal: GardienRoundReveal = { round: pub.round, keeperCorner, shots }
    const termine = pub.round >= GARDIEN_ROUNDS

    const nextPublic: GardienPublic = {
      ...pub,
      phase: termine ? 'over' : 'choose',
      deadlineAt: termine ? null : ctx.now + GARDIEN_CHOOSE_TIMEOUT_MS,
      round: pub.round + 1,
      chosen: [],
      points,
      sips,
      history: [...pub.history, reveal],
    }

    return {
      state: { public: nextPublic, secret: { choices: {} } },
      events: [{ type: 'reveal', ...reveal }],
      ...(termine ? { result: buildResult(nextPublic) } : {}),
    }
  },

  view(state, viewer) {
    return {
      publicView: state.public,
      // Chacun revoit son propre choix, jamais celui des autres.
      privateView: { myCorner: state.secret.choices[viewer] ?? null },
    }
  },
}
