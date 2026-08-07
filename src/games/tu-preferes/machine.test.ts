import { describe, it, expect } from 'vitest'
import { createRng } from '@/engine/rng'
import { InvalidActionError, type PlayerId, type ReduceContext } from '@/engine/types'
import {
  tuPreferesMachine,
  type QuestionBinaire,
  type QuestionJoueur,
  type TuPreferesPublic,
  type TuPreferesQuestion,
  type TuPreferesState,
} from './machine'
import {
  TP_MAX_PLAYER_SIPS,
  TP_MINORITY_SIPS,
  TP_NO_VOTE_SIPS,
  TP_QUESTIONS_PER_ROUND,
  TP_TIE_SIPS,
  TP_VOTE_TIMEOUT_MS,
} from './definition'

const BINAIRE: QuestionBinaire = { id: 'test-b', type: 'binaire', a: 'Le chaud', b: 'Le froid' }
const JOUEUR: QuestionJoueur = { id: 'test-j', type: 'joueur', text: 'de rater son train' }

function ctx(actor: PlayerId, now = 1_000): ReduceContext {
  return { rng: createRng(`tp-${actor}`), now, mode: 'board', actor }
}

function makeState(opts: {
  question: TuPreferesQuestion
  participants?: PlayerId[]
  index?: number
  total?: number
  queue?: TuPreferesQuestion[]
  votes?: Record<PlayerId, string>
  voted?: PlayerId[]
}): TuPreferesState {
  const participants = opts.participants ?? ['a', 'b', 'c']
  const zero: Record<PlayerId, number> = {}
  for (const id of participants) zero[id] = 0

  const pub: TuPreferesPublic = {
    phase: 'vote',
    deadlineAt: 1_000 + TP_VOTE_TIMEOUT_MS,
    participants,
    current: opts.question,
    index: opts.index ?? 0,
    total: opts.total ?? 5,
    voted: opts.voted ?? [],
    points: { ...zero },
    sips: { ...zero },
    history: [],
  }

  return {
    public: pub,
    secret: { queue: opts.queue ?? [BINAIRE, BINAIRE, BINAIRE, BINAIRE], votes: opts.votes ?? {} },
  }
}

/** Fait voter toute une liste de joueurs, dans l'ordre. */
function voter(state: TuPreferesState, bulletins: Array<[PlayerId, string]>) {
  let courant = { state, events: [], result: undefined } as ReturnType<
    typeof tuPreferesMachine.reduce
  >
  courant = { ...courant, state }
  for (const [joueur, choix] of bulletins) {
    courant = tuPreferesMachine.reduce(courant.state, { type: 'vote', choice: choix }, ctx(joueur))
  }
  return courant
}

describe('init', () => {
  it('tire cinq questions et expose la première', () => {
    const s = tuPreferesMachine.init({
      participants: ['a', 'b', 'c'],
      rng: createRng('tp-init'),
      now: 0,
      mode: 'free',
    })
    expect(s.public.total).toBe(TP_QUESTIONS_PER_ROUND)
    expect(s.public.current).not.toBeNull()
    expect(s.secret.queue).toHaveLength(TP_QUESTIONS_PER_ROUND - 1)
  })

  it('mélange des deux types de questions', () => {
    const s = tuPreferesMachine.init({
      participants: ['a', 'b', 'c'],
      rng: createRng('tp-mix'),
      now: 0,
      mode: 'free',
    })
    const types = new Set([s.public.current?.type, ...s.secret.queue.map((q) => q.type)])
    expect(types).toEqual(new Set(['binaire', 'joueur']))
  })
})

describe('question binaire', () => {
  it('fait boire la minorité et donne un point à la majorité', () => {
    const out = voter(makeState({ question: BINAIRE }), [
      ['a', 'a'],
      ['b', 'a'],
      ['c', 'b'],
    ])

    expect(out.state.public.sips['c']).toBe(TP_MINORITY_SIPS)
    expect(out.state.public.sips['a']).toBe(0)
    expect(out.state.public.points['a']).toBe(1)
    expect(out.state.public.points['b']).toBe(1)
    expect(out.state.public.points['c']).toBe(0)
  })

  it('en cas d’égalité parfaite, tout le monde boit une gorgée', () => {
    const out = voter(makeState({ question: BINAIRE, participants: ['a', 'b', 'c', 'd'] }), [
      ['a', 'a'],
      ['b', 'a'],
      ['c', 'b'],
      ['d', 'b'],
    ])

    expect(out.state.public.sips).toEqual({
      a: TP_TIE_SIPS,
      b: TP_TIE_SIPS,
      c: TP_TIE_SIPS,
      d: TP_TIE_SIPS,
    })
    expect(out.state.public.points['a']).toBe(0)
  })

  it('ne résout rien tant que tout le monde n’a pas voté', () => {
    const out = voter(makeState({ question: BINAIRE }), [['a', 'a']])
    expect(out.state.public.history).toHaveLength(0)
    expect(out.state.public.voted).toEqual(['a'])
  })

  it('refuse un choix autre que « a » ou « b »', () => {
    expect(() =>
      tuPreferesMachine.reduce(
        makeState({ question: BINAIRE }),
        { type: 'vote', choice: 'c' },
        ctx('a'),
      ),
    ).toThrow(InvalidActionError)
  })
})

describe('question joueur', () => {
  it('fait boire le plus désigné, autant de gorgées que de votes', () => {
    const out = voter(makeState({ question: JOUEUR }), [
      ['a', 'c'],
      ['b', 'c'],
      ['c', 'a'],
    ])

    expect(out.state.public.sips['c']).toBe(2)
    expect(out.state.public.sips['a']).toBe(0)
    // a et b ont lu le groupe correctement.
    expect(out.state.public.points['a']).toBe(1)
    expect(out.state.public.points['b']).toBe(1)
    expect(out.state.public.points['c']).toBe(0)
  })

  it('plafonne les gorgées', () => {
    const joueurs = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const out = voter(makeState({ question: JOUEUR, participants: joueurs }), [
      ['a', 'g'],
      ['b', 'g'],
      ['c', 'g'],
      ['d', 'g'],
      ['e', 'g'],
      ['f', 'g'],
      ['g', 'a'],
    ])

    expect(out.state.public.sips['g']).toBe(TP_MAX_PLAYER_SIPS)
  })

  it('fait boire tous les ex æquo', () => {
    const out = voter(makeState({ question: JOUEUR, participants: ['a', 'b', 'c', 'd'] }), [
      ['a', 'c'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'd'],
    ])

    expect(out.state.public.sips['c']).toBe(2)
    expect(out.state.public.sips['d']).toBe(2)
  })

  it('refuse un vote pour quelqu’un d’extérieur à la partie', () => {
    expect(() =>
      tuPreferesMachine.reduce(
        makeState({ question: JOUEUR }),
        { type: 'vote', choice: 'inconnu' },
        ctx('a'),
      ),
    ).toThrow(InvalidActionError)
  })
})

describe('abstention', () => {
  it('fait boire deux gorgées à ceux qui n’ont pas voté', () => {
    const partiel = voter(makeState({ question: BINAIRE }), [
      ['a', 'a'],
      ['b', 'a'],
    ])
    const out = tuPreferesMachine.reduce(partiel.state, { type: 'timeout' }, ctx('a', 999_999))

    expect(out.state.public.sips['c']).toBe(TP_NO_VOTE_SIPS)
  })

  it('refuse le timeout avant la date limite', () => {
    expect(() =>
      tuPreferesMachine.reduce(makeState({ question: BINAIRE }), { type: 'timeout' }, ctx('a')),
    ).toThrow(InvalidActionError)
  })
})

describe('actions illégales', () => {
  it('rejette un joueur extérieur', () => {
    expect(() =>
      tuPreferesMachine.reduce(
        makeState({ question: BINAIRE }),
        { type: 'vote', choice: 'a' },
        ctx('zzz'),
      ),
    ).toThrow(InvalidActionError)
  })

  it('rejette un second vote', () => {
    const premier = voter(makeState({ question: BINAIRE }), [['a', 'a']])
    expect(() =>
      tuPreferesMachine.reduce(premier.state, { type: 'vote', choice: 'b' }, ctx('a')),
    ).toThrow(InvalidActionError)
  })

  it('refuse une charge utile malformée', () => {
    expect(() => tuPreferesMachine.parseAction({ type: 'vote' })).toThrow()
    expect(() => tuPreferesMachine.parseAction({ type: 'vote', choice: '' })).toThrow()
  })
})

describe('secret des votes', () => {
  it('n’expose pas les votes dans la vue publique avant révélation', () => {
    const out = voter(makeState({ question: BINAIRE }), [['a', 'a']])
    const vue = tuPreferesMachine.view(out.state, 'b')
    expect(JSON.stringify(vue.publicView)).not.toContain('"a":"a"')
    expect(vue.privateView).toEqual({ myVote: null })
  })

  it('rend à chaque joueur son propre vote', () => {
    const out = voter(makeState({ question: BINAIRE }), [['a', 'a']])
    expect(tuPreferesMachine.view(out.state, 'a').privateView).toEqual({ myVote: 'a' })
  })
})

describe('fin de manche', () => {
  it('s’arrête après la dernière question et rend un classement', () => {
    const out = voter(makeState({ question: BINAIRE, index: 4, total: 5, queue: [] }), [
      ['a', 'a'],
      ['b', 'a'],
      ['c', 'b'],
    ])

    expect(out.state.public.phase).toBe('over')
    expect(out.state.public.current).toBeNull()
    expect(out.result?.ranking).toEqual([['a', 'b'], ['c']])
    expect(out.result?.sips['c']).toBe(TP_MINORITY_SIPS)
  })

  it('enchaîne sur la question suivante tant qu’il en reste', () => {
    const out = voter(makeState({ question: BINAIRE, index: 0, total: 5, queue: [JOUEUR] }), [
      ['a', 'a'],
      ['b', 'a'],
      ['c', 'b'],
    ])

    expect(out.state.public.phase).toBe('vote')
    expect(out.state.public.current).toEqual(JOUEUR)
    expect(out.state.public.voted).toEqual([])
    expect(out.state.secret.votes).toEqual({})
  })

  it('rejette toute action après la fin', () => {
    const out = voter(makeState({ question: BINAIRE, index: 4, total: 5, queue: [] }), [
      ['a', 'a'],
      ['b', 'a'],
      ['c', 'b'],
    ])
    expect(() =>
      tuPreferesMachine.reduce(out.state, { type: 'vote', choice: 'a' }, ctx('a')),
    ).toThrow(InvalidActionError)
  })
})
