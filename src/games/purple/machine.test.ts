import { describe, it, expect } from 'vitest'
import { createRng } from '@/engine/rng'
import type { Card, Rank, Suit } from '@/engine/cards'
import { InvalidActionError, type PlayMode, type PlayerId, type ReduceContext } from '@/engine/types'
import { availableBets, purpleMachine, type PurplePublic, type PurpleState } from './machine'
import { PURPLE_BET_TIMEOUT_MS } from './definition'

const JOUEURS: PlayerId[] = ['a', 'b', 'c']

const c = (rank: Rank, suit: Suit): Card => ({ rank, suit })

function zero(): Record<PlayerId, number> {
  return { a: 0, b: 0, c: 0 }
}

function makeState(opts: {
  deck: Card[]
  discard?: Card[]
  reference?: Card | null
  bank?: number
  currentIndex?: number
  failures?: number
  fails?: Record<PlayerId, number>
  contributions?: Record<PlayerId, number>
  drank?: Record<PlayerId, number>
}): PurpleState {
  const pub: PurplePublic = {
    phase: 'bet',
    deadlineAt: 1_000 + PURPLE_BET_TIMEOUT_MS,
    order: [...JOUEURS],
    currentIndex: opts.currentIndex ?? 0,
    reference: opts.reference === undefined ? c('7', '♠') : opts.reference,
    bank: opts.bank ?? 0,
    failures: opts.failures ?? 0,
    fails: opts.fails ?? zero(),
    contributions: opts.contributions ?? zero(),
    drank: opts.drank ?? zero(),
    history: [],
    cardsLeft: opts.deck.length,
  }
  return {
    public: pub,
    secret: { deck: opts.deck, discard: opts.discard ?? [], reshuffles: 0 },
  }
}

function ctx(actor: PlayerId, mode: PlayMode = 'free', now = 1_000): ReduceContext {
  return { rng: createRng('test-deterministe'), now, mode, actor }
}

describe('availableBets', () => {
  it('n’offre ni plus haut ni plus bas au premier tour', () => {
    expect(availableBets(null)).toEqual(['red', 'black', 'purple'])
  })

  it('offre les cinq paris dès qu’une référence existe', () => {
    expect(availableBets(c('7', '♠'))).toEqual(['red', 'black', 'higher', 'lower', 'purple'])
  })
})

describe('init', () => {
  it('démarre sans référence, banque vide, 52 cartes', () => {
    const s = purpleMachine.init({
      participants: JOUEURS,
      rng: createRng('init'),
      now: 0,
      mode: 'free',
    })
    expect(s.public.reference).toBeNull()
    expect(s.public.bank).toBe(0)
    expect(s.secret.deck).toHaveLength(52)
    expect(s.public.currentIndex).toBe(0)
  })
})

describe('réussites', () => {
  it('une réussite simple ajoute +1 à la banque et passe au joueur suivant', () => {
    const s = makeState({ deck: [c('K', '♥')], bank: 4 })
    const out = purpleMachine.reduce(s, { type: 'bet', bet: 'red' }, ctx('a'))

    expect(out.state.public.bank).toBe(5)
    expect(out.state.public.contributions['a']).toBe(1)
    expect(out.state.public.currentIndex).toBe(1)
    expect(out.state.public.drank['a']).toBe(0)
    expect(out.result).toBeUndefined()
  })

  it('un Purple réussi ajoute +5 à la banque', () => {
    // deux cartes de couleurs différentes → Purple gagnant
    const s = makeState({ deck: [c('2', '♥'), c('9', '♠')], bank: 3 })
    const out = purpleMachine.reduce(s, { type: 'bet', bet: 'purple' }, ctx('a'))

    expect(out.state.public.bank).toBe(8)
    expect(out.state.public.contributions['a']).toBe(5)
  })

  it('après un Purple, la référence devient la DEUXIÈME carte tirée', () => {
    const s = makeState({ deck: [c('2', '♥'), c('9', '♠')] })
    const out = purpleMachine.reduce(s, { type: 'bet', bet: 'purple' }, ctx('a'))

    expect(out.state.public.reference).toEqual(c('9', '♠'))
  })

  it('« plus haut » réussit strictement au-dessus de la référence', () => {
    const s = makeState({ deck: [c('8', '♣')], reference: c('7', '♠') })
    const out = purpleMachine.reduce(s, { type: 'bet', bet: 'higher' }, ctx('a'))
    expect(out.state.public.bank).toBe(1)
  })
})

describe('échecs', () => {
  it('le fautif boit exactement la banque, qui repart à zéro', () => {
    const s = makeState({ deck: [c('K', '♠')], bank: 7 })
    const out = purpleMachine.reduce(s, { type: 'bet', bet: 'red' }, ctx('a'))

    expect(out.state.public.drank['a']).toBe(7)
    expect(out.state.public.bank).toBe(0)
    expect(out.state.public.failures).toBe(1)
    expect(out.state.public.fails['a']).toBe(1)
  })

  it('un Purple raté fait aussi boire toute la banque', () => {
    // deux cartes de la MÊME couleur → Purple perdu
    const s = makeState({ deck: [c('2', '♥'), c('9', '♦')], bank: 12 })
    const out = purpleMachine.reduce(s, { type: 'bet', bet: 'purple' }, ctx('a'))

    expect(out.state.public.drank['a']).toBe(12)
    expect(out.state.public.bank).toBe(0)
  })

  it('l’égalité en plus/moins est un échec', () => {
    const s = makeState({ deck: [c('7', '♥')], reference: c('7', '♠'), bank: 5 })

    const haut = purpleMachine.reduce(s, { type: 'bet', bet: 'higher' }, ctx('a'))
    expect(haut.state.public.drank['a']).toBe(5)

    const bas = purpleMachine.reduce(s, { type: 'bet', bet: 'lower' }, ctx('a'))
    expect(bas.state.public.drank['a']).toBe(5)
  })

  it('une banque vide ne fait rien boire, mais compte comme un échec', () => {
    const s = makeState({ deck: [c('K', '♠')], bank: 0 })
    const out = purpleMachine.reduce(s, { type: 'bet', bet: 'red' }, ctx('a'))

    expect(out.state.public.drank['a']).toBe(0)
    expect(out.state.public.failures).toBe(1)
  })
})

describe('actions illégales', () => {
  it('rejette une action d’un joueur dont ce n’est pas le tour', () => {
    const s = makeState({ deck: [c('K', '♥')] })
    expect(() => purpleMachine.reduce(s, { type: 'bet', bet: 'red' }, ctx('b'))).toThrow(
      InvalidActionError,
    )
  })

  it('rejette « plus haut » au premier tour, faute de référence', () => {
    const s = makeState({ deck: [c('K', '♥')], reference: null })
    expect(() => purpleMachine.reduce(s, { type: 'bet', bet: 'higher' }, ctx('a'))).toThrow(
      InvalidActionError,
    )
  })

  it('rejette toute action sur une manche terminée', () => {
    const s = makeState({ deck: [c('K', '♥')] })
    const fini: PurpleState = { ...s, public: { ...s.public, phase: 'over' } }
    expect(() => purpleMachine.reduce(fini, { type: 'bet', bet: 'red' }, ctx('a'))).toThrow(
      InvalidActionError,
    )
  })

  it('refuse une charge utile malformée', () => {
    expect(() => purpleMachine.parseAction({ type: 'bet', bet: 'violet' })).toThrow()
    expect(() => purpleMachine.parseAction({ type: 'inconnu' })).toThrow()
  })

  it('accepte les charges utiles valides', () => {
    expect(purpleMachine.parseAction({ type: 'bet', bet: 'purple' })).toEqual({
      type: 'bet',
      bet: 'purple',
    })
  })
})

describe('expiration de phase', () => {
  it('refuse le timeout avant la date limite', () => {
    const s = makeState({ deck: [c('K', '♥')] })
    expect(() => purpleMachine.reduce(s, { type: 'timeout' }, ctx('a', 'free', 2_000))).toThrow(
      InvalidActionError,
    )
  })

  it('joue à la place du joueur absent une fois la date limite passée', () => {
    const s = makeState({ deck: [c('K', '♥')] })
    const out = purpleMachine.reduce(s, { type: 'timeout' }, ctx('a', 'free', 999_999))

    expect(out.state.public.currentIndex).toBe(1)
    expect(out.state.public.history[0]?.player).toBe('a')
    expect(['red', 'black']).toContain(out.state.public.history[0]?.bet)
  })
})

describe('paquet épuisé', () => {
  it('remélange la défausse et poursuit la partie', () => {
    const s = makeState({
      deck: [],
      discard: [c('A', '♥'), c('3', '♦')],
      reference: c('K', '♠'),
    })
    const out = purpleMachine.reduce(s, { type: 'bet', bet: 'lower' }, ctx('a'))

    // Peu importe laquelle des deux cartes sort : les deux sont sous le Roi.
    expect(out.state.public.bank).toBe(1)
    expect(out.state.secret.reshuffles).toBe(1)
  })
})

describe('fin de manche', () => {
  it('en mode Plateau, le 3ᵉ échec termine la manche et rend un résultat', () => {
    const s = makeState({ deck: [c('K', '♠')], bank: 2, failures: 2 })
    const out = purpleMachine.reduce(s, { type: 'bet', bet: 'red' }, ctx('a', 'board'))

    expect(out.state.public.phase).toBe('over')
    expect(out.result).toBeDefined()
    expect(out.result?.sips['a']).toBe(2)
  })

  it('en mode libre, le 3ᵉ échec ne termine rien', () => {
    const s = makeState({ deck: [c('K', '♠')], bank: 2, failures: 2 })
    const out = purpleMachine.reduce(s, { type: 'bet', bet: 'red' }, ctx('a', 'free'))

    expect(out.state.public.phase).toBe('bet')
    expect(out.result).toBeUndefined()
  })

  it('« finish » clôt la manche en mode libre uniquement', () => {
    const s = makeState({ deck: [c('K', '♠')] })
    expect(purpleMachine.reduce(s, { type: 'finish' }, ctx('a', 'free')).result).toBeDefined()
    expect(() => purpleMachine.reduce(s, { type: 'finish' }, ctx('a', 'board'))).toThrow(
      InvalidActionError,
    )
  })

  it('classe par échecs croissants puis contributions décroissantes', () => {
    const s = makeState({
      deck: [c('K', '♠')],
      fails: { a: 0, b: 0, c: 1 },
      contributions: { a: 5, b: 2, c: 10 },
    })
    const out = purpleMachine.reduce(s, { type: 'finish' }, ctx('a', 'free'))

    expect(out.result?.ranking).toEqual([['a'], ['b'], ['c']])
  })

  it('groupe les ex æquo dans le même rang', () => {
    const s = makeState({
      deck: [c('K', '♠')],
      fails: { a: 0, b: 0, c: 1 },
      contributions: { a: 4, b: 4, c: 9 },
    })
    const out = purpleMachine.reduce(s, { type: 'finish' }, ctx('a', 'free'))

    expect(out.result?.ranking).toEqual([['a', 'b'], ['c']])
  })
})

describe('view', () => {
  it('n’expose jamais le paquet', () => {
    const s = makeState({ deck: [c('K', '♠'), c('2', '♥')] })
    const vue = purpleMachine.view(s, 'a')
    expect(JSON.stringify(vue)).not.toContain('deck')
    expect(vue.privateView).toBeNull()
  })
})
