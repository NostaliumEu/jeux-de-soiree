/**
 * L'Imposteur — rôles cachés et information asymétrique.
 *
 * Tout le monde reçoit le même mot, sauf un joueur qui en reçoit un proche.
 * Chacun donne un indice à son tour, les indices sont publics au fur et à
 * mesure — c'est tout l'intérêt : le dernier à parler en sait plus que le
 * premier, et l'imposteur peut se caler sur ce qu'il a entendu. Puis on vote.
 *
 * C'est le premier jeu du catalogue à envoyer une information DIFFÉRENTE à
 * chaque joueur. Le mot ne transite jamais par l'état public : il vit dans
 * l'état secret, et `view` n'en rend à chacun que sa part.
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
import brut from './content/mots.fr.json'
import {
  IMPOSTEUR_ABSENT_SIPS,
  IMPOSTEUR_DEMASQUE_SIPS,
  IMPOSTEUR_INDICE_TIMEOUT_MS,
  IMPOSTEUR_MAX_INDICE,
  IMPOSTEUR_RATE_SIPS,
  IMPOSTEUR_VOTE_TIMEOUT_MS,
} from './definition'

export interface PaireDeMots {
  commun: string
  imposteur: string
}

export const PAIRES: PaireDeMots[] = brut.paires

export interface Indice {
  player: PlayerId
  mot: string
}

export interface ImposteurPublic extends BasePublicState {
  phase: 'indice' | 'vote' | 'over'
  participants: PlayerId[]
  /** Ordre de prise de parole, tiré au sort. */
  order: PlayerId[]
  currentIndex: number
  /** Indices déjà donnés, dans l'ordre. Publics : c'est le cœur du jeu. */
  indices: Indice[]
  voted: PlayerId[]
  /** Renseignés seulement une fois la manche terminée. */
  votes: Record<PlayerId, PlayerId>
  imposteur: PlayerId | null
  motCommun: string | null
  motImposteur: string | null
  demasque: boolean | null
  points: Record<PlayerId, number>
  sips: Record<PlayerId, number>
}

export interface ImposteurSecret {
  imposteur: PlayerId
  motCommun: string
  motImposteur: string
  votes: Record<PlayerId, PlayerId>
}

export type ImposteurState = GameState<ImposteurPublic, ImposteurSecret>

export const imposteurActionSchema = z.union([
  z.object({ type: z.literal('indice'), mot: z.string().trim().min(1).max(IMPOSTEUR_MAX_INDICE) }),
  z.object({ type: z.literal('vote'), suspect: z.string().min(1) }),
  z.object({ type: z.literal('timeout') }),
])

export type ImposteurAction = z.infer<typeof imposteurActionSchema>

function zeroed(ids: readonly PlayerId[]): Record<PlayerId, number> {
  return Object.fromEntries(ids.map((id) => [id, 0]))
}

function joueurCourant(pub: ImposteurPublic): PlayerId {
  const id = pub.order[pub.currentIndex]
  if (id === undefined) throw new Error('Index de tour invalide')
  return id
}

function buildResult(pub: ImposteurPublic): GameResult {
  return {
    ranking: rankByScore(pub.participants, (id) => pub.points[id] ?? 0),
    sips: { ...pub.sips },
  }
}

/** Dépouille le vote et distribue les sanctions. */
function denouement(
  pub: ImposteurPublic,
  secret: ImposteurSecret,
  votes: Record<PlayerId, PlayerId>,
): ImposteurPublic {
  const points = { ...pub.points }
  const sips = { ...pub.sips }

  const comptes = new Map<PlayerId, number>()
  for (const votant of pub.participants) {
    const cible = votes[votant]
    if (cible === undefined) {
      // Ne pas voter, c'est se rendre complice.
      sips[votant] = (sips[votant] ?? 0) + IMPOSTEUR_ABSENT_SIPS
      continue
    }
    comptes.set(cible, (comptes.get(cible) ?? 0) + 1)
  }

  const max = comptes.size > 0 ? Math.max(...comptes.values()) : 0
  const designes = [...comptes.entries()].filter(([, n]) => n === max).map(([id]) => id)
  const demasque = designes.includes(secret.imposteur)

  if (demasque) {
    sips[secret.imposteur] = (sips[secret.imposteur] ?? 0) + IMPOSTEUR_DEMASQUE_SIPS
    // Seuls ceux qui ont effectivement désigné l'imposteur marquent.
    for (const votant of pub.participants) {
      if (votes[votant] === secret.imposteur) points[votant] = (points[votant] ?? 0) + 2
    }
  } else {
    for (const joueur of pub.participants) {
      if (joueur === secret.imposteur) continue
      sips[joueur] = (sips[joueur] ?? 0) + IMPOSTEUR_RATE_SIPS
    }
    points[secret.imposteur] = (points[secret.imposteur] ?? 0) + 3
  }

  return {
    ...pub,
    phase: 'over',
    deadlineAt: null,
    voted: [...pub.participants].filter((id) => votes[id] !== undefined),
    votes,
    imposteur: secret.imposteur,
    motCommun: secret.motCommun,
    motImposteur: secret.motImposteur,
    demasque,
    points,
    sips,
  }
}

export const imposteurMachine: GameMachine<ImposteurState, ImposteurAction> = {
  init(ctx) {
    const participants = [...ctx.participants]
    if (participants.length < 4) {
      throw new Error('L’Imposteur exige au moins quatre joueurs.')
    }

    const paire = ctx.rng.pick(PAIRES)
    const imposteur = ctx.rng.pick(participants)

    return {
      public: {
        phase: 'indice',
        deadlineAt: ctx.now + IMPOSTEUR_INDICE_TIMEOUT_MS,
        participants,
        order: shuffle(participants, ctx.rng),
        currentIndex: 0,
        indices: [],
        voted: [],
        votes: {},
        imposteur: null,
        motCommun: null,
        motImposteur: null,
        demasque: null,
        points: zeroed(participants),
        sips: zeroed(participants),
      },
      secret: {
        imposteur,
        motCommun: paire.commun,
        motImposteur: paire.imposteur,
        votes: {},
      },
    }
  },

  parseAction(raw) {
    return imposteurActionSchema.parse(raw)
  },

  reduce(state, action, ctx): ReduceOutcome<ImposteurState> {
    const pub = state.public

    if (pub.phase === 'over') {
      throw new InvalidActionError('La manche est terminée.')
    }

    const expire =
      action.type === 'timeout' && pub.deadlineAt !== null && ctx.now >= pub.deadlineAt

    if (action.type === 'timeout' && !expire) {
      throw new InvalidActionError('La phase n’a pas encore expiré.')
    }

    /* ------------------------------------------------- phase des indices -- */
    if (pub.phase === 'indice') {
      const tour = joueurCourant(pub)
      let mot: string

      if (action.type === 'timeout') {
        // Rester muet coûte une gorgée et laisse une trace : les autres verront
        // qu'il n'a rien dit, ce qui est une information en soi.
        mot = '…'
      } else if (action.type === 'indice') {
        if (ctx.actor !== tour) throw new InvalidActionError('Ce n’est pas ton tour.')
        mot = action.mot
      } else {
        throw new InvalidActionError('C’est le moment des indices, pas du vote.')
      }

      const indices = [...pub.indices, { player: tour, mot }]
      const sips =
        action.type === 'timeout'
          ? { ...pub.sips, [tour]: (pub.sips[tour] ?? 0) + IMPOSTEUR_ABSENT_SIPS }
          : pub.sips

      const tousOntParle = indices.length >= pub.order.length

      const suivant: ImposteurPublic = {
        ...pub,
        indices,
        sips,
        currentIndex: tousOntParle ? pub.currentIndex : pub.currentIndex + 1,
        phase: tousOntParle ? 'vote' : 'indice',
        deadlineAt:
          ctx.now + (tousOntParle ? IMPOSTEUR_VOTE_TIMEOUT_MS : IMPOSTEUR_INDICE_TIMEOUT_MS),
      }

      return {
        state: { public: suivant, secret: state.secret },
        events: [{ type: 'indice', player: tour, mot }],
      }
    }

    /* ---------------------------------------------------- phase du vote -- */
    let votes = { ...state.secret.votes }
    let voted = [...pub.voted]

    if (action.type === 'vote') {
      if (!pub.participants.includes(ctx.actor)) {
        throw new InvalidActionError('Tu ne participes pas à cette manche.')
      }
      if (voted.includes(ctx.actor)) {
        throw new InvalidActionError('Tu as déjà voté.')
      }
      if (!pub.participants.includes(action.suspect)) {
        throw new InvalidActionError('Il faut accuser quelqu’un de la partie.')
      }
      if (action.suspect === ctx.actor) {
        throw new InvalidActionError('On ne s’accuse pas soi-même.')
      }

      votes[ctx.actor] = action.suspect
      voted = [...voted, ctx.actor]

      if (voted.length < pub.participants.length) {
        return {
          state: {
            public: { ...pub, voted },
            secret: { ...state.secret, votes },
          },
          events: [{ type: 'voted', player: ctx.actor }],
        }
      }
    } else if (action.type === 'indice') {
      throw new InvalidActionError('Les indices sont terminés, il faut voter.')
    } else {
      votes = { ...votes }
    }

    const final = denouement(pub, state.secret, votes)

    return {
      state: { public: final, secret: { ...state.secret, votes } },
      events: [{ type: 'reveal', imposteur: state.secret.imposteur, demasque: final.demasque }],
      result: buildResult(final),
    }
  },

  view(state, viewer) {
    const { imposteur, motCommun, motImposteur } = state.secret

    // Chacun reçoit UN mot, et rien d'autre : surtout pas son rôle.
    //
    // C'est le cœur du jeu. Personne ne sait s'il tient le mot commun ou
    // l'intrus, donc chacun avance à couvert et se demande, à mesure que les
    // indices tombent, s'il n'est pas en train de se trahir. Dire à l'imposteur
    // qu'il est l'imposteur le transformerait en simple menteur, ce qui est un
    // exercice beaucoup moins intéressant — et une information de trop.
    return {
      publicView: state.public,
      privateView: {
        mot: viewer === imposteur ? motImposteur : motCommun,
        monVote: state.secret.votes[viewer] ?? null,
      },
    }
  },
}
