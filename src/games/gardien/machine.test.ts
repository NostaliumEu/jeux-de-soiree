import { describe, it, expect } from 'vitest'
import { createRng } from '@/engine/rng'
import { InvalidActionError, type PlayerId, type ReduceContext } from '@/engine/types'
import { gardienMachine, type Corner, type GardienState } from './machine'

const GARDIEN = 'g'
const TIREURS = ['t1', 't2', 't3']

function ctx(actor: PlayerId, now = 1_000): ReduceContext {
  return { rng: createRng(`gardien-${actor}`), now, mode: 'board', actor }
}

function fresh(): GardienState {
  return gardienMachine.init({
    participants: [GARDIEN, ...TIREURS],
    rng: createRng('gardien-init'),
    now: 1_000,
    mode: 'board',
  })
}

/** Joue une manche complète avec des coins imposés. */
function manche(state: GardienState, keeper: Corner, tirs: [Corner, Corner, Corner]) {
  let courant = gardienMachine.reduce(state, { type: 'choose', corner: keeper }, ctx(GARDIEN))
  TIREURS.forEach((tireur, i) => {
    courant = gardienMachine.reduce(
      courant.state,
      { type: 'choose', corner: tirs[i] as Corner },
      ctx(tireur),
    )
  })
  return courant
}

describe('init', () => {
  it('désigne le premier participant comme gardien', () => {
    const s = fresh()
    expect(s.public.keeper).toBe(GARDIEN)
    expect(s.public.shooters).toEqual(TIREURS)
    expect(s.public.round).toBe(1)
  })

  it('refuse moins de deux tireurs', () => {
    expect(() =>
      gardienMachine.init({
        participants: ['g', 't1'],
        rng: createRng('x'),
        now: 0,
        mode: 'board',
      }),
    ).toThrow()
  })
})

describe('révélation simultanée', () => {
  it('ne résout rien tant que tout le monde n’a pas choisi', () => {
    const out = gardienMachine.reduce(fresh(), { type: 'choose', corner: 'HG' }, ctx(GARDIEN))
    expect(out.state.public.history).toHaveLength(0)
    expect(out.state.public.chosen).toEqual([GARDIEN])
    expect(out.state.public.round).toBe(1)
  })

  it('arrête les tirs partis dans le coin du gardien', () => {
    const out = manche(fresh(), 'HG', ['HG', 'BD', 'HG'])
    const reveal = out.state.public.history[0]

    expect(reveal?.keeperCorner).toBe('HG')
    expect(reveal?.shots.filter((s) => s.saved).map((s) => s.shooter)).toEqual(['t1', 't3'])
    expect(reveal?.shots.find((s) => s.shooter === 't2')?.saved).toBe(false)
  })

  it('donne un point au gardien par arrêt et un point au tireur par but', () => {
    const out = manche(fresh(), 'HG', ['HG', 'BD', 'HG'])
    expect(out.state.public.points[GARDIEN]).toBe(2)
    expect(out.state.public.points['t2']).toBe(1)
    expect(out.state.public.points['t1']).toBe(0)
  })

  it('fait boire un tireur arrêté et le gardien par but encaissé', () => {
    const out = manche(fresh(), 'HG', ['HG', 'BD', 'HG'])
    expect(out.state.public.sips['t1']).toBe(1)
    expect(out.state.public.sips['t3']).toBe(1)
    expect(out.state.public.sips['t2']).toBe(0)
    expect(out.state.public.sips[GARDIEN]).toBe(1)
  })

  it('remet les choix à zéro entre deux manches', () => {
    const out = manche(fresh(), 'HG', ['HG', 'BD', 'C'])
    expect(out.state.secret.choices).toEqual({})
    expect(out.state.public.chosen).toEqual([])
    expect(out.state.public.round).toBe(2)
  })
})

describe('secret', () => {
  it('ne révèle à un joueur que son propre choix', () => {
    const out = gardienMachine.reduce(fresh(), { type: 'choose', corner: 'BD' }, ctx('t1'))

    expect(gardienMachine.view(out.state, 't1').privateView).toEqual({ myCorner: 'BD' })
    expect(gardienMachine.view(out.state, 't2').privateView).toEqual({ myCorner: null })
    expect(gardienMachine.view(out.state, GARDIEN).privateView).toEqual({ myCorner: null })
  })

  it('n’expose aucun choix dans la vue publique avant révélation', () => {
    const out = gardienMachine.reduce(fresh(), { type: 'choose', corner: 'BD' }, ctx('t1'))
    expect(JSON.stringify(out.state.public)).not.toContain('BD')
  })
})

describe('actions illégales', () => {
  it('rejette un joueur qui ne participe pas', () => {
    expect(() =>
      gardienMachine.reduce(fresh(), { type: 'choose', corner: 'HG' }, ctx('inconnu')),
    ).toThrow(InvalidActionError)
  })

  it('rejette un second choix sur la même manche', () => {
    const premier = gardienMachine.reduce(fresh(), { type: 'choose', corner: 'HG' }, ctx('t1'))
    expect(() =>
      gardienMachine.reduce(premier.state, { type: 'choose', corner: 'BD' }, ctx('t1')),
    ).toThrow(InvalidActionError)
  })

  it('refuse un coin inexistant', () => {
    expect(() => gardienMachine.parseAction({ type: 'choose', corner: 'MILIEU' })).toThrow()
  })
})

describe('expiration', () => {
  it('refuse le timeout avant la date limite', () => {
    expect(() => gardienMachine.reduce(fresh(), { type: 'timeout' }, ctx('t1', 1_100))).toThrow(
      InvalidActionError,
    )
  })

  it('choisit au hasard pour les absents et résout la manche', () => {
    const out = gardienMachine.reduce(fresh(), { type: 'timeout' }, ctx('t1', 999_999))
    expect(out.state.public.history).toHaveLength(1)
    expect(out.state.public.history[0]?.shots).toHaveLength(3)
  })
})

describe('fin de partie', () => {
  it('se termine après trois manches et rend un classement', () => {
    let s = fresh()
    // t2 marque à chaque manche, t1 et t3 sont arrêtés à chaque fois.
    for (let i = 0; i < 2; i++) {
      s = manche(s, 'HG', ['HG', 'BD', 'HG']).state
      expect(s.public.phase).toBe('choose')
    }
    const fin = manche(s, 'HG', ['HG', 'BD', 'HG'])

    expect(fin.state.public.phase).toBe('over')
    expect(fin.result).toBeDefined()
    // Gardien : 6 arrêts. t2 : 3 buts. t1 et t3 : 0.
    expect(fin.result?.ranking).toEqual([[GARDIEN], ['t2'], ['t1', 't3']])
    expect(fin.result?.sips['t1']).toBe(3)
    expect(fin.result?.sips[GARDIEN]).toBe(3)
  })

  it('rejette toute action après la fin', () => {
    let s = fresh()
    for (let i = 0; i < 3; i++) s = manche(s, 'HG', ['HG', 'BD', 'HG']).state
    expect(() => gardienMachine.reduce(s, { type: 'choose', corner: 'HG' }, ctx(GARDIEN))).toThrow(
      InvalidActionError,
    )
  })
})
