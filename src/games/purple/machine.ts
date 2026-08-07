/**
 * Purple — jeu de cartes à banque centrale.
 *
 * Chaque joueur fait UNE prédiction puis passe la main, quoi qu'il arrive.
 * Il choisit lui-même son pari : c'est là qu'est toute la stratégie, puisque
 * « plus haut » sur un As est quasi certain là où un 7 laisse tout ouvert.
 *
 * Une réussite met +1 dans la banque commune (+5 pour un Purple, qui est un
 * cul sec). Un échec fait boire au fautif l'intégralité de la banque, qui
 * repart alors à zéro. Il n'existe aucune banque individuelle et aucun échange
 * de gorgées entre joueurs.
 */

import { z } from 'zod'
import { buildDeck, cardValue, colorOf, type Card } from '@/engine/cards'
import { shuffle, type Rng } from '@/engine/rng'
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
  PURPLE_BET_TIMEOUT_MS,
  PURPLE_BOARD_FAILURE_LIMIT,
  PURPLE_HISTORY_LENGTH,
  PURPLE_PURPLE_REWARD,
  PURPLE_SIMPLE_REWARD,
} from './definition'

export type PurpleBet = 'red' | 'black' | 'higher' | 'lower' | 'purple'

export interface PurpleReveal {
  player: PlayerId
  bet: PurpleBet
  cards: Card[]
  success: boolean
  /** Gorgées mises en banque si réussite, gorgées bues si échec. */
  amount: number
}

export interface PurplePublic extends BasePublicState {
  phase: 'bet' | 'over'
  order: PlayerId[]
  currentIndex: number
  reference: Card | null
  bank: number
  /** Échecs cumulés dans la manche, tous joueurs confondus. */
  failures: number
  /** Échecs par joueur — sert au classement rendu au mode Plateau. */
  fails: Record<PlayerId, number>
  /** Gorgées apportées à la banque par joueur. */
  contributions: Record<PlayerId, number>
  /** Gorgées bues par joueur. */
  sips: Record<PlayerId, number>
  history: PurpleReveal[]
  cardsLeft: number
}

export interface PurpleSecret {
  deck: Card[]
  discard: Card[]
  reshuffles: number
}

export type PurpleState = GameState<PurplePublic, PurpleSecret>

export const purpleActionSchema = z.union([
  z.object({
    type: z.literal('bet'),
    bet: z.enum(['red', 'black', 'higher', 'lower', 'purple']),
  }),
  z.object({ type: z.literal('timeout') }),
  z.object({ type: z.literal('finish') }),
])

export type PurpleAction = z.infer<typeof purpleActionSchema>

/**
 * Au tout premier tour il n'y a pas encore de carte de référence : « plus haut »
 * et « plus bas » n'ont alors aucun sens et ne sont pas proposés.
 */
export function availableBets(reference: Card | null): PurpleBet[] {
  return reference === null
    ? ['red', 'black', 'purple']
    : ['red', 'black', 'higher', 'lower', 'purple']
}

function currentPlayer(pub: PurplePublic): PlayerId {
  const id = pub.order[pub.currentIndex]
  if (id === undefined) throw new Error('Index de tour invalide')
  return id
}

interface DrawResult {
  cards: Card[]
  deck: Card[]
  discard: Card[]
  reshuffles: number
}

/** Pioche `count` cartes, en remélangeant la défausse si le paquet est vide. */
function drawCards(secret: PurpleSecret, count: number, rng: Rng): DrawResult {
  let deck = [...secret.deck]
  let discard = [...secret.discard]
  let reshuffles = secret.reshuffles
  const cards: Card[] = []

  for (let i = 0; i < count; i++) {
    if (deck.length === 0) {
      if (discard.length === 0) throw new Error('Plus aucune carte disponible')
      deck = shuffle(discard, rng)
      discard = []
      reshuffles += 1
    }
    cards.push(deck.shift() as Card)
  }

  return { cards, deck, discard, reshuffles }
}

function resolve(bet: PurpleBet, reference: Card | null, drawn: Card[]): boolean {
  const first = drawn[0]
  if (first === undefined) throw new Error('Aucune carte piochée')

  switch (bet) {
    case 'red':
      return colorOf(first) === 'red'
    case 'black':
      return colorOf(first) === 'black'
    case 'higher': {
      if (reference === null) throw new Error('« Plus haut » sans carte de référence')
      // L'égalité est un échec.
      return cardValue(first) > cardValue(reference)
    }
    case 'lower': {
      if (reference === null) throw new Error('« Plus bas » sans carte de référence')
      return cardValue(first) < cardValue(reference)
    }
    case 'purple': {
      const second = drawn[1]
      if (second === undefined) throw new Error('Purple exige deux cartes')
      return colorOf(first) !== colorOf(second)
    }
  }
}

function buildResult(pub: PurplePublic): GameResult {
  // Ne jamais se planter d'abord, alimenter la banque ensuite. Le multiplicateur
  // garantit qu'un échec pèse toujours plus lourd que n'importe quelle
  // contribution, sans avoir à écrire un comparateur à plusieurs niveaux.
  const score = (player: PlayerId): number =>
    -(pub.fails[player] ?? 0) * 100_000 + (pub.contributions[player] ?? 0)

  const groupes = new Map<number, PlayerId[]>()
  for (const player of pub.order) {
    const valeur = score(player)
    const existant = groupes.get(valeur)
    if (existant) existant.push(player)
    else groupes.set(valeur, [player])
  }

  return {
    ranking: [...groupes.entries()].sort((a, b) => b[0] - a[0]).map(([, ids]) => ids),
    sips: { ...pub.sips },
  }
}

function zeroed(participants: readonly PlayerId[]): Record<PlayerId, number> {
  const out: Record<PlayerId, number> = {}
  for (const id of participants) out[id] = 0
  return out
}

export const purpleMachine: GameMachine<PurpleState, PurpleAction> = {
  init(ctx) {
    return {
      public: {
        phase: 'bet',
        deadlineAt: ctx.now + PURPLE_BET_TIMEOUT_MS,
        order: [...ctx.participants],
        currentIndex: 0,
        reference: null,
        bank: 0,
        failures: 0,
        fails: zeroed(ctx.participants),
        contributions: zeroed(ctx.participants),
        sips: zeroed(ctx.participants),
        history: [],
        cardsLeft: 52,
      },
      secret: {
        deck: shuffle(buildDeck(), ctx.rng),
        discard: [],
        reshuffles: 0,
      },
    }
  },

  parseAction(raw) {
    return purpleActionSchema.parse(raw)
  },

  reduce(state, action, ctx): ReduceOutcome<PurpleState> {
    const pub = state.public

    if (pub.phase === 'over') {
      throw new InvalidActionError('La manche est terminée.')
    }

    if (action.type === 'finish') {
      if (ctx.mode !== 'free') {
        throw new InvalidActionError('En mode Plateau, la manche s’arrête d’elle-même.')
      }
      const closed: PurpleState = {
        public: { ...pub, phase: 'over', deadlineAt: null },
        secret: state.secret,
      }
      return { state: closed, events: [{ type: 'finished' }], result: buildResult(pub) }
    }

    const tour = currentPlayer(pub)
    let bet: PurpleBet

    if (action.type === 'timeout') {
      if (pub.deadlineAt === null || ctx.now < pub.deadlineAt) {
        throw new InvalidActionError('La phase n’a pas encore expiré.')
      }
      // Un téléphone verrouillé ne doit jamais bloquer la table : on joue à sa
      // place un rouge/noir tiré au sort et la partie continue.
      bet = ctx.rng.next() < 0.5 ? 'red' : 'black'
    } else {
      if (ctx.actor !== tour) {
        throw new InvalidActionError('Ce n’est pas ton tour.')
      }
      if (!availableBets(pub.reference).includes(action.bet)) {
        throw new InvalidActionError(`Pari indisponible pour l’instant : ${action.bet}.`)
      }
      bet = action.bet
    }

    const count = bet === 'purple' ? 2 : 1
    const draw = drawCards(state.secret, count, ctx.rng)
    const success = resolve(bet, pub.reference, draw.cards)
    const gain = bet === 'purple' ? PURPLE_PURPLE_REWARD : PURPLE_SIMPLE_REWARD

    // Après un Purple, la référence devient la DEUXIÈME carte tirée.
    const newReference = draw.cards[draw.cards.length - 1] as Card
    const versDefausse = [
      ...(pub.reference ? [pub.reference] : []),
      ...draw.cards.slice(0, -1),
    ]

    const bank = success ? pub.bank + gain : 0
    const bue = success ? 0 : pub.bank

    const reveal: PurpleReveal = {
      player: tour,
      bet,
      cards: draw.cards,
      success,
      amount: success ? gain : bue,
    }

    const failures = success ? pub.failures : pub.failures + 1
    const nextPublic: PurplePublic = {
      ...pub,
      reference: newReference,
      bank,
      failures,
      fails: success ? pub.fails : { ...pub.fails, [tour]: (pub.fails[tour] ?? 0) + 1 },
      contributions: success
        ? { ...pub.contributions, [tour]: (pub.contributions[tour] ?? 0) + gain }
        : pub.contributions,
      sips: success ? pub.sips : { ...pub.sips, [tour]: (pub.sips[tour] ?? 0) + bue },
      history: [reveal, ...pub.history].slice(0, PURPLE_HISTORY_LENGTH),
      currentIndex: (pub.currentIndex + 1) % pub.order.length,
      cardsLeft: draw.deck.length,
      deadlineAt: ctx.now + PURPLE_BET_TIMEOUT_MS,
    }

    const events = [
      {
        type: success ? 'success' : 'failure',
        player: tour,
        bet,
        cards: draw.cards,
        amount: reveal.amount,
      },
    ]

    // En mode Plateau la manche s'arrête au 3ᵉ échec, peu importe les quantités.
    // En mode libre elle tourne jusqu'à ce que le groupe dise stop.
    const termine = ctx.mode === 'board' && failures >= PURPLE_BOARD_FAILURE_LIMIT

    const closedPublic: PurplePublic = termine
      ? { ...nextPublic, phase: 'over', deadlineAt: null }
      : nextPublic

    const nextState: PurpleState = {
      public: closedPublic,
      secret: {
        deck: draw.deck,
        discard: [...draw.discard, ...versDefausse],
        reshuffles: draw.reshuffles,
      },
    }

    return {
      state: nextState,
      events,
      ...(termine ? { result: buildResult(closedPublic) } : {}),
    }
  },

  view(state) {
    // Purple n'a aucun secret par joueur : le paquet est caché à tout le monde.
    return { publicView: state.public, privateView: null }
  },
}
