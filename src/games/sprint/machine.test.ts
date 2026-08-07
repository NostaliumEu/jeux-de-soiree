import { describe, it, expect } from 'vitest'
import { createRng } from '@/engine/rng'
import { InvalidActionError, type PlayerId, type ReduceContext } from '@/engine/types'
import { plafondCredible, sprintMachine, type SprintPublic, type SprintState } from './machine'
import {
  SPRINT_COUNTDOWN_MS,
  SPRINT_LIMIT_MS,
  SPRINT_MAX_BATCH,
  SPRINT_SIPS,
  SPRINT_TARGET,
} from './definition'

const JOUEURS: PlayerId[] = ['a', 'b', 'c']
const DEPART = 4_000

function ctx(actor: PlayerId, now: number): ReduceContext {
  return { rng: createRng('sprint'), now, mode: 'free', actor }
}

function makeState(progress: Partial<Record<PlayerId, number>> = {}, finishers: PlayerId[] = []): SprintState {
  const pub: SprintPublic = {
    phase: 'course',
    startsAt: DEPART,
    deadlineAt: DEPART + SPRINT_LIMIT_MS,
    participants: [...JOUEURS],
    target: SPRINT_TARGET,
    progress: { a: progress.a ?? 0, b: progress.b ?? 0, c: progress.c ?? 0 },
    finishers,
    sips: { a: 0, b: 0, c: 0 },
  }
  return { public: pub, secret: {} }
}

/** Instant où le plafond crédible laisse passer `taps` coups. */
const instantPour = (taps: number) => DEPART + Math.ceil((taps / 25) * 1_000) + 500

describe('init', () => {
  it('laisse un décompte avant le départ', () => {
    const s = sprintMachine.init({
      participants: JOUEURS,
      rng: createRng('i'),
      now: 1_000,
      mode: 'free',
    })
    expect(s.public.startsAt).toBe(1_000 + SPRINT_COUNTDOWN_MS)
    expect(s.public.progress).toEqual({ a: 0, b: 0, c: 0 })
  })

  it('refuse un seul joueur', () => {
    expect(() =>
      sprintMachine.init({ participants: ['a'], rng: createRng('x'), now: 0, mode: 'free' }),
    ).toThrow()
  })
})

describe('faux départ', () => {
  it('refuse les coups avant le signal', () => {
    expect(() =>
      sprintMachine.reduce(makeState(), { type: 'taps', count: 5 }, ctx('a', DEPART - 1)),
    ).toThrow(InvalidActionError)
  })
})

describe('progression', () => {
  it('additionne les paquets de coups', () => {
    const s = makeState()
    const un = sprintMachine.reduce(s, { type: 'taps', count: 10 }, ctx('a', instantPour(40)))
    const deux = sprintMachine.reduce(
      un.state,
      { type: 'taps', count: 8 },
      ctx('a', instantPour(40)),
    )
    expect(deux.state.public.progress['a']).toBe(18)
  })

  it('n’affecte que l’auteur du paquet', () => {
    const out = sprintMachine.reduce(makeState(), { type: 'taps', count: 10 }, ctx('a', instantPour(40)))
    expect(out.state.public.progress['b']).toBe(0)
  })

  it('rejette un joueur extérieur', () => {
    expect(() =>
      sprintMachine.reduce(makeState(), { type: 'taps', count: 5 }, ctx('zzz', instantPour(40))),
    ).toThrow(InvalidActionError)
  })
})

describe('plafond anti-triche', () => {
  it('borne la progression à ce qu’un pouce humain peut produire', () => {
    // Juste après le départ, on ne peut pas avoir déjà tapé la jauge entière.
    const out = sprintMachine.reduce(
      makeState(),
      { type: 'taps', count: SPRINT_MAX_BATCH },
      ctx('a', DEPART + 10),
    )
    expect(out.state.public.progress['a']).toBeLessThan(SPRINT_TARGET)
  })

  it('empêche de remplir la jauge en enchaînant les paquets instantanément', () => {
    let s = makeState()
    for (let i = 0; i < 20; i++) {
      s = sprintMachine.reduce(s, { type: 'taps', count: SPRINT_MAX_BATCH }, ctx('a', DEPART + 50))
        .state
    }
    expect(s.public.progress['a']).toBeLessThan(SPRINT_TARGET)
    expect(s.public.finishers).toEqual([])
  })

  it('laisse passer une cadence normale sur la durée', () => {
    expect(plafondCredible(DEPART, DEPART + 5_000)).toBeGreaterThanOrEqual(SPRINT_TARGET)
  })

  it('refuse un paquet plus gros que la limite', () => {
    expect(() => sprintMachine.parseAction({ type: 'taps', count: SPRINT_MAX_BATCH + 1 })).toThrow()
    expect(() => sprintMachine.parseAction({ type: 'taps', count: 0 })).toThrow()
    expect(() => sprintMachine.parseAction({ type: 'taps', count: 3.5 })).toThrow()
  })
})

describe('arrivée', () => {
  it('enregistre celui qui remplit sa jauge', () => {
    const s = makeState({ a: SPRINT_TARGET - 5 })
    const out = sprintMachine.reduce(s, { type: 'taps', count: 5 }, ctx('a', instantPour(80)))

    expect(out.state.public.progress['a']).toBe(SPRINT_TARGET)
    expect(out.state.public.finishers).toEqual(['a'])
  })

  it('ne dépasse jamais la jauge', () => {
    const s = makeState({ a: SPRINT_TARGET - 2 })
    const out = sprintMachine.reduce(s, { type: 'taps', count: 20 }, ctx('a', instantPour(80)))
    expect(out.state.public.progress['a']).toBe(SPRINT_TARGET)
  })

  it('refuse de continuer une fois arrivé', () => {
    const s = makeState({ a: SPRINT_TARGET }, ['a'])
    expect(() =>
      sprintMachine.reduce(s, { type: 'taps', count: 3 }, ctx('a', instantPour(80))),
    ).toThrow(InvalidActionError)
  })

  it('s’arrête quand il ne reste plus personne à départager', () => {
    // a est déjà arrivé ; dès que b arrive, seul c reste : inutile de le faire
    // taper dans le vide.
    const s = makeState({ a: SPRINT_TARGET, b: SPRINT_TARGET - 3 }, ['a'])
    const out = sprintMachine.reduce(s, { type: 'taps', count: 3 }, ctx('b', instantPour(80)))

    expect(out.state.public.phase).toBe('over')
    expect(out.result?.ranking).toEqual([['a'], ['b'], ['c']])
  })
})

describe('classement et gorgées', () => {
  it('épargne le vainqueur et sanctionne le dernier', () => {
    const s = makeState({ a: SPRINT_TARGET, b: SPRINT_TARGET - 3, c: 10 }, ['a'])
    const out = sprintMachine.reduce(s, { type: 'taps', count: 3 }, ctx('b', instantPour(80)))

    expect(out.result?.sips['a']).toBe(SPRINT_SIPS[0])
    expect(out.result?.sips['b']).toBe(SPRINT_SIPS[1])
    expect(out.result?.sips['c']).toBe(SPRINT_SIPS[2])
  })

  it('classe les non-arrivés selon leur jauge à l’expiration', () => {
    const s = makeState({ a: 40, b: 55, c: 12 })
    const out = sprintMachine.reduce(s, { type: 'timeout' }, ctx('a', 999_999))

    expect(out.state.public.phase).toBe('over')
    expect(out.result?.ranking).toEqual([['b'], ['a'], ['c']])
  })

  it('groupe les jauges identiques', () => {
    const s = makeState({ a: 30, b: 30, c: 5 })
    const out = sprintMachine.reduce(s, { type: 'timeout' }, ctx('a', 999_999))
    expect(out.result?.ranking).toEqual([['a', 'b'], ['c']])
  })

  it('refuse une expiration réclamée trop tôt', () => {
    expect(() =>
      sprintMachine.reduce(makeState(), { type: 'timeout' }, ctx('a', DEPART + 1_000)),
    ).toThrow(InvalidActionError)
  })
})
