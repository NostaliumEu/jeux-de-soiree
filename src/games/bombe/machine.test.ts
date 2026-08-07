import { describe, it, expect } from 'vitest'
import { createRng } from '@/engine/rng'
import { InvalidActionError, type PlayerId, type ReduceContext } from '@/engine/types'
import { bombeMachine, type BombePublic, type BombeState } from './machine'
import { BOMBE_MAX_MS, BOMBE_MIN_MS, BOMBE_SIPS } from './definition'

const JOUEURS: PlayerId[] = ['a', 'b', 'c', 'd']

function ctx(actor: PlayerId, now = 1_000): ReduceContext {
  return { rng: createRng(`bombe-${actor}-${now}`), now, mode: 'free', actor }
}

function fresh(): BombeState {
  return bombeMachine.init({
    participants: JOUEURS,
    rng: createRng('bombe-init'),
    now: 1_000,
    mode: 'free',
  })
}

/** Construit un état maîtrisé, avec un instant d'explosion imposé. */
function makeState(opts: {
  explodeAt: number
  holderIndex?: number
  round?: number
  passes?: Record<PlayerId, number>
  explosions?: Record<PlayerId, number>
}): BombeState {
  const pub: BombePublic = {
    phase: 'passe',
    deadlineAt: 1_000 + BOMBE_MAX_MS,
    armedAt: 1_000,
    order: [...JOUEURS],
    holderIndex: opts.holderIndex ?? 0,
    round: opts.round ?? 1,
    passes: opts.passes ?? { a: 0, b: 0, c: 0, d: 0 },
    explosions: opts.explosions ?? { a: 0, b: 0, c: 0, d: 0 },
    sips: { a: 0, b: 0, c: 0, d: 0 },
    history: [],
  }
  return { public: pub, secret: { explodeAt: opts.explodeAt } }
}

describe('init', () => {
  it('arme la bombe dans la fenêtre prévue', () => {
    for (let i = 0; i < 40; i++) {
      const s = bombeMachine.init({
        participants: JOUEURS,
        rng: createRng(`arme-${i}`),
        now: 1_000,
        mode: 'free',
      })
      expect(s.secret.explodeAt).toBeGreaterThanOrEqual(1_000 + BOMBE_MIN_MS)
      expect(s.secret.explodeAt).toBeLessThanOrEqual(1_000 + BOMBE_MAX_MS)
    }
  })

  it('donne la bombe au premier joueur', () => {
    expect(fresh().public.holderIndex).toBe(0)
  })

  it('refuse moins de trois joueurs', () => {
    expect(() =>
      bombeMachine.init({ participants: ['a', 'b'], rng: createRng('x'), now: 0, mode: 'free' }),
    ).toThrow()
  })
})

describe('secret', () => {
  it('ne révèle l’instant d’explosion à personne, pas même au porteur', () => {
    const s = fresh()
    for (const j of JOUEURS) {
      const vue = bombeMachine.view(s, j)
      expect(vue.privateView).toBeNull()
      expect(JSON.stringify(vue.publicView)).not.toContain(String(s.secret.explodeAt))
    }
  })
})

describe('passer la bombe', () => {
  it('la transmet au joueur suivant', () => {
    const s = makeState({ explodeAt: 50_000 })
    const out = bombeMachine.reduce(s, { type: 'pass' }, ctx('a', 2_000))

    expect(out.state.public.holderIndex).toBe(1)
    expect(out.state.public.passes['a']).toBe(1)
    expect(out.state.public.history).toHaveLength(0)
  })

  it('boucle sur le premier joueur', () => {
    const s = makeState({ explodeAt: 50_000, holderIndex: 3 })
    const out = bombeMachine.reduce(s, { type: 'pass' }, ctx('d', 2_000))
    expect(out.state.public.holderIndex).toBe(0)
  })

  it('refuse le tap de quelqu’un qui ne l’a pas', () => {
    const s = makeState({ explodeAt: 50_000 })
    expect(() => bombeMachine.reduce(s, { type: 'pass' }, ctx('c', 2_000))).toThrow(
      InvalidActionError,
    )
  })
})

describe('explosion', () => {
  it('éclate au visage de qui passe trop tard', () => {
    const s = makeState({ explodeAt: 5_000 })
    const out = bombeMachine.reduce(s, { type: 'pass' }, ctx('a', 5_001))

    expect(out.state.public.history[0]).toMatchObject({ victim: 'a', round: 1 })
    expect(out.state.public.sips['a']).toBe(BOMBE_SIPS[0])
    expect(out.state.public.explosions['a']).toBe(1)
  })

  it('éclate à l’échéance sur celui qui la garde', () => {
    const s = makeState({ explodeAt: 5_000, holderIndex: 2 })
    const out = bombeMachine.reduce(s, { type: 'timeout' }, ctx('a', 999_999))

    expect(out.state.public.history[0]?.victim).toBe('c')
    expect(out.state.public.sips['c']).toBe(BOMBE_SIPS[0])
  })

  it('refuse une explosion réclamée avant l’échéance', () => {
    const s = makeState({ explodeAt: 5_000 })
    expect(() => bombeMachine.reduce(s, { type: 'timeout' }, ctx('a', 2_000))).toThrow(
      InvalidActionError,
    )
  })

  it('rend la bombe à sa victime pour la manche suivante', () => {
    const s = makeState({ explodeAt: 5_000, holderIndex: 2 })
    const out = bombeMachine.reduce(s, { type: 'pass' }, ctx('c', 5_001))

    expect(out.state.public.holderIndex).toBe(2)
    expect(out.state.public.round).toBe(2)
  })

  it('réarme une nouvelle échéance après chaque explosion', () => {
    const s = makeState({ explodeAt: 5_000 })
    const out = bombeMachine.reduce(s, { type: 'pass' }, ctx('a', 5_001))

    expect(out.state.secret.explodeAt).toBeGreaterThan(5_001)
    expect(out.state.public.deadlineAt).toBe(5_001 + BOMBE_MAX_MS)
  })

  it('fait monter la sanction à chaque explosion', () => {
    const s = makeState({ explodeAt: 5_000, round: 2 })
    const out = bombeMachine.reduce(s, { type: 'pass' }, ctx('a', 5_001))
    expect(out.state.public.sips['a']).toBe(BOMBE_SIPS[1])
  })
})

describe('fin de manche', () => {
  it('s’arrête à la troisième explosion', () => {
    const s = makeState({ explodeAt: 5_000, round: 3 })
    const out = bombeMachine.reduce(s, { type: 'pass' }, ctx('a', 5_001))

    expect(out.state.public.phase).toBe('over')
    expect(out.result).toBeDefined()
    expect(out.state.public.deadlineAt).toBeNull()
  })

  it('classe les moins touchés devant', () => {
    const s = makeState({
      explodeAt: 5_000,
      round: 3,
      explosions: { a: 0, b: 2, c: 0, d: 0 },
      passes: { a: 9, b: 0, c: 3, d: 1 },
    })
    const out = bombeMachine.reduce(s, { type: 'pass' }, ctx('a', 5_001))

    // a encaisse la troisième : b (2 explosions) et a (1) ferment la marche.
    expect(out.result?.ranking[0]).toEqual(['c'])
    expect(out.result?.ranking[out.result.ranking.length - 1]).toEqual(['b'])
  })

  it('rejette toute action après la fin', () => {
    const s = makeState({ explodeAt: 5_000, round: 3 })
    const fini = bombeMachine.reduce(s, { type: 'pass' }, ctx('a', 5_001)).state
    expect(() => bombeMachine.reduce(fini, { type: 'pass' }, ctx('a', 6_000))).toThrow(
      InvalidActionError,
    )
  })
})

describe('actions illégales', () => {
  it('refuse une charge utile malformée', () => {
    expect(() => bombeMachine.parseAction({ type: 'boum' })).toThrow()
    expect(() => bombeMachine.parseAction({})).toThrow()
  })
})
