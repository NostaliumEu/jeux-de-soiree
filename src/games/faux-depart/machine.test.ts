import { describe, it, expect } from 'vitest'
import { createRng } from '@/engine/rng'
import { InvalidActionError, type PlayerId, type ReduceContext } from '@/engine/types'
import { fauxDepartMachine, type FauxDepartState } from './machine'
import { FD_SIPS, FD_SIPS_FALSE_START } from './definition'

function ctx(actor: PlayerId, now = 1_000): ReduceContext {
  return { rng: createRng(`fd-${actor}-${now}`), now, mode: 'board', actor }
}

function fresh(): FauxDepartState {
  return fauxDepartMachine.init({
    participants: ['a', 'b'],
    rng: createRng('fd-init'),
    now: 1_000,
    mode: 'board',
  })
}

/** Joue un essai complet : `a` puis `b` tapent. */
function essai(state: FauxDepartState, offsetA: number, offsetB: number) {
  const premier = fauxDepartMachine.reduce(state, { type: 'tap', offsetMs: offsetA }, ctx('a'))
  return fauxDepartMachine.reduce(premier.state, { type: 'tap', offsetMs: offsetB }, ctx('b'))
}

describe('init', () => {
  it('arme un premier essai avec un vert dans le futur', () => {
    const s = fresh()
    expect(s.public.phase).toBe('arming')
    expect(s.public.greenAt).toBeGreaterThan(1_000)
    expect(s.public.wins).toEqual({ a: 0, b: 0 })
    expect(s.public.attempt).toBe(1)
  })

  it('laisse une fenêtre de réaction après le vert', () => {
    const s = fresh()
    expect(s.public.deadlineAt).toBeGreaterThan(s.public.greenAt)
  })

  it('refuse un effectif différent de deux', () => {
    expect(() =>
      fauxDepartMachine.init({
        participants: ['a', 'b', 'c'],
        rng: createRng('x'),
        now: 0,
        mode: 'board',
      }),
    ).toThrow()
  })
})

describe('résolution d’un essai', () => {
  it('le temps de réaction le plus bas gagne', () => {
    const out = essai(fresh(), 210, 340)
    expect(out.state.public.wins['a']).toBe(1)
    expect(out.state.public.wins['b']).toBe(0)
  })

  it('n’a pas résolu tant que le second n’a pas tapé', () => {
    const out = fauxDepartMachine.reduce(fresh(), { type: 'tap', offsetMs: 200 }, ctx('a'))
    expect(out.state.public.wins).toEqual({ a: 0, b: 0 })
    expect(out.state.public.attempt).toBe(1)
  })

  it('taper avant le vert perd l’essai immédiatement', () => {
    const out = essai(fresh(), -120, 400)
    expect(out.state.public.wins['b']).toBe(1)
    expect(out.state.public.history[0]?.falseStart).toBe(true)
  })

  it('un temps sous le plancher humain compte comme un faux départ', () => {
    // 30 ms est physiologiquement impossible : anticipation ou triche.
    const out = essai(fresh(), 30, 400)
    expect(out.state.public.wins['b']).toBe(1)
    expect(out.state.public.history[0]?.falseStart).toBe(true)
  })

  it('double faux départ : celui qui a tapé le plus tôt perd', () => {
    const out = essai(fresh(), -300, -50)
    expect(out.state.public.wins['b']).toBe(1)
    expect(out.state.public.wins['a']).toBe(0)
  })

  it('égalité parfaite : personne ne marque, on rejoue', () => {
    const out = essai(fresh(), 250, 250)
    expect(out.state.public.wins).toEqual({ a: 0, b: 0 })
    expect(out.state.public.attempt).toBe(2)
    expect(out.state.public.phase).toBe('arming')
  })

  it('réarme un nouveau vert cohérent avec sa date limite', () => {
    const out = essai(fresh(), 210, 340)
    expect(out.state.public.taps).toEqual({})
    expect(out.state.public.deadlineAt).toBe(out.state.public.greenAt + 5_000)
  })
})

describe('fin du duel', () => {
  it('le premier à deux essais l’emporte', () => {
    const un = essai(fresh(), 200, 300)
    expect(un.result).toBeUndefined()

    const deux = essai(un.state, 200, 300)
    expect(deux.state.public.phase).toBe('over')
    expect(deux.result?.ranking).toEqual([['a'], ['b']])
  })

  it('le perdant boit deux gorgées', () => {
    const un = essai(fresh(), 200, 300)
    const deux = essai(un.state, 200, 300)
    expect(deux.result?.sips).toEqual({ a: 0, b: FD_SIPS })
  })

  it('le perdant boit trois gorgées si l’essai décisif est un faux départ', () => {
    const un = essai(fresh(), 200, 300)
    const deux = essai(un.state, 200, -40)
    expect(deux.result?.sips).toEqual({ a: 0, b: FD_SIPS_FALSE_START })
  })

  it('rejette toute action après la fin', () => {
    const un = essai(fresh(), 200, 300)
    const deux = essai(un.state, 200, 300)
    expect(() =>
      fauxDepartMachine.reduce(deux.state, { type: 'tap', offsetMs: 100 }, ctx('a')),
    ).toThrow(InvalidActionError)
  })
})

describe('actions illégales', () => {
  it('rejette un joueur extérieur au duel', () => {
    expect(() =>
      fauxDepartMachine.reduce(fresh(), { type: 'tap', offsetMs: 200 }, ctx('c')),
    ).toThrow(InvalidActionError)
  })

  it('rejette un second tap du même joueur sur le même essai', () => {
    const premier = fauxDepartMachine.reduce(fresh(), { type: 'tap', offsetMs: 200 }, ctx('a'))
    expect(() =>
      fauxDepartMachine.reduce(premier.state, { type: 'tap', offsetMs: 150 }, ctx('a')),
    ).toThrow(InvalidActionError)
  })

  it('refuse une charge utile malformée', () => {
    expect(() => fauxDepartMachine.parseAction({ type: 'tap' })).toThrow()
    expect(() => fauxDepartMachine.parseAction({ type: 'tap', offsetMs: 'vite' })).toThrow()
  })
})

describe('expiration', () => {
  it('refuse le timeout avant la date limite', () => {
    expect(() => fauxDepartMachine.reduce(fresh(), { type: 'timeout' }, ctx('a', 1_100))).toThrow(
      InvalidActionError,
    )
  })

  it('donne l’essai à celui qui a tapé quand l’autre ne réagit pas', () => {
    const s = fresh()
    const premier = fauxDepartMachine.reduce(s, { type: 'tap', offsetMs: 240 }, ctx('a'))
    const out = fauxDepartMachine.reduce(premier.state, { type: 'timeout' }, ctx('a', 999_999))
    expect(out.state.public.wins['a']).toBe(1)
  })

  it('rejoue l’essai si personne n’a tapé', () => {
    const out = fauxDepartMachine.reduce(fresh(), { type: 'timeout' }, ctx('a', 999_999))
    expect(out.state.public.wins).toEqual({ a: 0, b: 0 })
    expect(out.state.public.attempt).toBe(2)
  })
})
