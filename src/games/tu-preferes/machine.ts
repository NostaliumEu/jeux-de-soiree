/**
 * Tu préfères / Qui est le plus susceptible — vote simultané à N joueurs.
 *
 * Cinq questions par manche, tirées d'un fichier de contenu versionné dans le
 * dépôt. C'est le jeu qui grossit tout seul : proposer une question ne demande
 * aucune ligne de code, seulement une entrée dans `content/questions.fr.json`.
 *
 * Les votes vivent dans l'état secret jusqu'à la révélation, sans quoi le
 * dernier à voter verrait le résultat avant de se décider.
 */

import { z } from 'zod'
import { shuffle } from '@/engine/rng'
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
import brut from './content/questions.fr.json'
import {
  TP_BINAIRE_PER_ROUND,
  TP_MAX_PLAYER_SIPS,
  TP_MINORITY_SIPS,
  TP_NO_VOTE_SIPS,
  TP_QUESTIONS_PER_ROUND,
  TP_TIE_SIPS,
  TP_VOTE_TIMEOUT_MS,
} from './definition'

export interface QuestionBinaire {
  id: string
  type: 'binaire'
  a: string
  b: string
}

export interface QuestionJoueur {
  id: string
  type: 'joueur'
  text: string
}

export type TuPreferesQuestion = QuestionBinaire | QuestionJoueur

export const POOL_BINAIRE: QuestionBinaire[] = brut.binaire.map((q) => ({
  id: q.id,
  type: 'binaire',
  a: q.a,
  b: q.b,
}))

export const POOL_JOUEUR: QuestionJoueur[] = brut.joueur.map((q) => ({
  id: q.id,
  type: 'joueur',
  text: q.text,
}))

export interface TuPreferesReveal {
  question: TuPreferesQuestion
  votes: Record<PlayerId, string>
  /** Qui boit et combien, pour cette question précise. */
  sips: Record<PlayerId, number>
  /** Phrase courte affichée sous la révélation. */
  verdict: string
}

export interface TuPreferesPublic extends BasePublicState {
  phase: 'vote' | 'over'
  participants: PlayerId[]
  current: TuPreferesQuestion | null
  index: number
  total: number
  /** Qui a déjà voté — sans révéler pour quoi. */
  voted: PlayerId[]
  points: Record<PlayerId, number>
  sips: Record<PlayerId, number>
  history: TuPreferesReveal[]
}

export interface TuPreferesSecret {
  /** Questions restantes, hors question courante. */
  queue: TuPreferesQuestion[]
  votes: Record<PlayerId, string>
}

export type TuPreferesState = GameState<TuPreferesPublic, TuPreferesSecret>

export const tuPreferesActionSchema = z.union([
  z.object({ type: z.literal('vote'), choice: z.string().min(1).max(64) }),
  z.object({ type: z.literal('timeout') }),
])

export type TuPreferesAction = z.infer<typeof tuPreferesActionSchema>

function zeroed(ids: readonly PlayerId[]): Record<PlayerId, number> {
  const out: Record<PlayerId, number> = {}
  for (const id of ids) out[id] = 0
  return out
}

function pickQuestions(rng: Parameters<typeof shuffle>[1]): TuPreferesQuestion[] {
  const binaires = shuffle(POOL_BINAIRE, rng).slice(0, TP_BINAIRE_PER_ROUND)
  const joueurs = shuffle(POOL_JOUEUR, rng).slice(0, TP_QUESTIONS_PER_ROUND - TP_BINAIRE_PER_ROUND)
  return shuffle([...binaires, ...joueurs], rng)
}

interface Resolution {
  sips: Record<PlayerId, number>
  points: Record<PlayerId, number>
  verdict: string
}

function resolveBinaire(
  question: QuestionBinaire,
  participants: readonly PlayerId[],
  votes: Record<PlayerId, string>,
): Resolution {
  const sips = zeroed(participants)
  const points = zeroed(participants)

  const pourA = participants.filter((p) => votes[p] === 'a')
  const pourB = participants.filter((p) => votes[p] === 'b')
  const absents = participants.filter((p) => votes[p] === undefined)

  for (const absent of absents) sips[absent] = TP_NO_VOTE_SIPS

  let verdict: string
  if (pourA.length === pourB.length) {
    // Égalité parfaite : personne n'est en minorité, tout le monde trinque.
    for (const votant of [...pourA, ...pourB]) sips[votant] = TP_TIE_SIPS
    verdict = `Égalité parfaite : ${pourA.length} contre ${pourB.length}. Tout le monde boit ${TP_TIE_SIPS}.`
  } else {
    const minorite = pourA.length < pourB.length ? pourA : pourB
    const majorite = pourA.length < pourB.length ? pourB : pourA
    const choixMajoritaire = pourA.length < pourB.length ? question.b : question.a

    for (const perdant of minorite) sips[perdant] = TP_MINORITY_SIPS
    for (const gagnant of majorite) points[gagnant] = 1
    verdict = `La majorité a choisi « ${choixMajoritaire} ». La minorité boit ${TP_MINORITY_SIPS}.`
  }

  return { sips, points, verdict }
}

function resolveJoueur(
  participants: readonly PlayerId[],
  votes: Record<PlayerId, string>,
): Resolution {
  const sips = zeroed(participants)
  const points = zeroed(participants)

  const comptes = new Map<PlayerId, number>()
  for (const votant of participants) {
    const cible = votes[votant]
    if (cible === undefined) {
      sips[votant] = TP_NO_VOTE_SIPS
      continue
    }
    comptes.set(cible, (comptes.get(cible) ?? 0) + 1)
  }

  if (comptes.size === 0) {
    return { sips, points, verdict: 'Personne n’a voté. Tout le monde s’en sort.' }
  }

  const max = Math.max(...comptes.values())
  const designes = [...comptes.entries()].filter(([, n]) => n === max).map(([id]) => id)

  for (const designe of designes) {
    sips[designe] = (sips[designe] ?? 0) + Math.min(max, TP_MAX_PLAYER_SIPS)
  }

  // Avoir su lire le groupe rapporte un point.
  for (const votant of participants) {
    const cible = votes[votant]
    if (cible !== undefined && designes.includes(cible)) points[votant] = 1
  }

  const gorgees = Math.min(max, TP_MAX_PLAYER_SIPS)
  const verdict =
    designes.length > 1
      ? `Égalité à ${max} voix : ils boivent ${gorgees} chacun.`
      : `Désigné ${max} fois. ${gorgees} gorgées.`

  return { sips, points, verdict }
}

function fusionner(
  base: Record<PlayerId, number>,
  delta: Record<PlayerId, number>,
): Record<PlayerId, number> {
  const out = { ...base }
  for (const [id, valeur] of Object.entries(delta)) out[id] = (out[id] ?? 0) + valeur
  return out
}

function buildResult(pub: TuPreferesPublic): GameResult {
  return {
    ranking: rankByScore(pub.participants, (id) => pub.points[id] ?? 0),
    sips: { ...pub.sips },
  }
}

export const tuPreferesMachine: GameMachine<TuPreferesState, TuPreferesAction> = {
  init(ctx) {
    const questions = pickQuestions(ctx.rng)
    const [premiere, ...reste] = questions
    if (premiere === undefined) throw new Error('Aucune question disponible')

    return {
      public: {
        phase: 'vote',
        deadlineAt: ctx.now + TP_VOTE_TIMEOUT_MS,
        participants: [...ctx.participants],
        current: premiere,
        index: 0,
        total: questions.length,
        voted: [],
        points: zeroed(ctx.participants),
        sips: zeroed(ctx.participants),
        history: [],
      },
      secret: { queue: reste, votes: {} },
    }
  },

  parseAction(raw) {
    return tuPreferesActionSchema.parse(raw)
  },

  reduce(state, action, ctx): ReduceOutcome<TuPreferesState> {
    const pub = state.public

    if (pub.phase === 'over') {
      throw new InvalidActionError('La manche est terminée.')
    }

    const question = pub.current
    if (question === null) throw new Error('Aucune question courante')

    let votes = { ...state.secret.votes }
    let voted = [...pub.voted]

    if (action.type === 'vote') {
      if (!pub.participants.includes(ctx.actor)) {
        throw new InvalidActionError('Tu ne participes pas à cette manche.')
      }
      if (voted.includes(ctx.actor)) {
        throw new InvalidActionError('Tu as déjà voté sur cette question.')
      }
      if (question.type === 'binaire') {
        if (action.choice !== 'a' && action.choice !== 'b') {
          throw new InvalidActionError('Réponse attendue : « a » ou « b ».')
        }
      } else if (!pub.participants.includes(action.choice)) {
        throw new InvalidActionError('Il faut désigner un joueur de la partie.')
      }

      votes[ctx.actor] = action.choice
      voted = [...voted, ctx.actor]

      if (voted.length < pub.participants.length) {
        return {
          state: { public: { ...pub, voted }, secret: { ...state.secret, votes } },
          events: [{ type: 'voted', player: ctx.actor }],
        }
      }
    } else {
      if (pub.deadlineAt === null || ctx.now < pub.deadlineAt) {
        throw new InvalidActionError('Le vote n’a pas encore expiré.')
      }
      // Les absents ne votent pas : ils boivent, et la question se résout.
      votes = { ...votes }
    }

    const resolution =
      question.type === 'binaire'
        ? resolveBinaire(question, pub.participants, votes)
        : resolveJoueur(pub.participants, votes)

    const reveal: TuPreferesReveal = {
      question,
      votes,
      sips: resolution.sips,
      verdict: resolution.verdict,
    }

    const index = pub.index + 1
    const termine = index >= pub.total
    const [suivante, ...reste] = state.secret.queue

    const nextPublic: TuPreferesPublic = {
      ...pub,
      phase: termine ? 'over' : 'vote',
      deadlineAt: termine ? null : ctx.now + TP_VOTE_TIMEOUT_MS,
      current: termine ? null : (suivante ?? null),
      index,
      voted: [],
      points: fusionner(pub.points, resolution.points),
      sips: fusionner(pub.sips, resolution.sips),
      history: [...pub.history, reveal],
    }

    return {
      state: {
        public: nextPublic,
        secret: { queue: termine ? [] : reste, votes: {} },
      },
      events: [{ type: 'reveal', question: question.id, verdict: resolution.verdict }],
      ...(termine ? { result: buildResult(nextPublic) } : {}),
    }
  },

  view(state, viewer) {
    return {
      publicView: state.public,
      privateView: { myVote: state.secret.votes[viewer] ?? null },
    }
  },
}
