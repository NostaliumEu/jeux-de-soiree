import { describe, it, expect } from 'vitest'
import { createRng } from '@/engine/rng'
import { InvalidActionError, type PlayerId, type ReduceContext } from '@/engine/types'
import { imposteurMachine, type ImposteurState } from './machine'
import {
  IMPOSTEUR_ABSENT_SIPS,
  IMPOSTEUR_DEMASQUE_SIPS,
  IMPOSTEUR_RATE_SIPS,
} from './definition'

const JOUEURS: PlayerId[] = ['a', 'b', 'c', 'd']

function ctx(actor: PlayerId, now = 1_000): ReduceContext {
  return { rng: createRng(`imp-${actor}`), now, mode: 'free', actor }
}

function fresh(seed = 'imp-init'): ImposteurState {
  return imposteurMachine.init({
    participants: JOUEURS,
    rng: createRng(seed),
    now: 1_000,
    mode: 'free',
  })
}

/** Fait donner son indice à tout le monde, dans l'ordre tiré. */
function tousLesIndices(state: ImposteurState): ImposteurState {
  let courant = state
  for (let i = 0; i < JOUEURS.length; i++) {
    const tour = courant.public.order[courant.public.currentIndex] as PlayerId
    courant = imposteurMachine.reduce(courant, { type: 'indice', mot: `mot-${i}` }, ctx(tour)).state
  }
  return courant
}

describe('init', () => {
  it('démarre par les indices, sans rien révéler', () => {
    const s = fresh()
    expect(s.public.phase).toBe('indice')
    expect(s.public.imposteur).toBeNull()
    expect(s.public.motCommun).toBeNull()
    expect(s.public.indices).toEqual([])
  })

  it('refuse moins de quatre joueurs', () => {
    expect(() =>
      imposteurMachine.init({
        participants: ['a', 'b', 'c'],
        rng: createRng('x'),
        now: 0,
        mode: 'free',
      }),
    ).toThrow()
  })

  it('désigne un imposteur parmi les participants', () => {
    for (let i = 0; i < 30; i++) {
      expect(JOUEURS).toContain(fresh(`seed-${i}`).secret.imposteur)
    }
  })

  it('donne deux mots différents', () => {
    const s = fresh()
    expect(s.secret.motCommun).not.toBe(s.secret.motImposteur)
  })
})

describe('secret des rôles', () => {
  it('ne dit à personne s’il est l’imposteur', () => {
    const s = fresh()
    for (const joueur of JOUEURS) {
      const vue = imposteurMachine.view(s, joueur).privateView as Record<string, unknown>
      expect(Object.keys(vue).sort()).toEqual(['monVote', 'mot'])
      expect(JSON.stringify(vue)).not.toContain('imposteur')
    }
  })

  it('donne à l’imposteur un mot différent de celui des autres', () => {
    const s = fresh()
    const motDe = (j: PlayerId) =>
      (imposteurMachine.view(s, j).privateView as { mot: string }).mot

    const mots = new Map<string, PlayerId[]>()
    for (const j of JOUEURS) {
      const m = motDe(j)
      mots.set(m, [...(mots.get(m) ?? []), j])
    }

    expect(mots.size).toBe(2)
    const isole = [...mots.values()].find((liste) => liste.length === 1)
    expect(isole).toEqual([s.secret.imposteur])
  })

  it('n’expose ni les mots ni l’imposteur dans la vue publique', () => {
    const s = tousLesIndices(fresh())
    const publique = JSON.stringify(imposteurMachine.view(s, 'a').publicView)
    expect(publique).not.toContain(s.secret.motCommun)
    expect(publique).not.toContain(s.secret.motImposteur)
  })
})

describe('phase des indices', () => {
  it('rend chaque indice public au fur et à mesure', () => {
    const s = fresh()
    const tour = s.public.order[0] as PlayerId
    const out = imposteurMachine.reduce(s, { type: 'indice', mot: 'sable' }, ctx(tour))

    expect(out.state.public.indices).toEqual([{ player: tour, mot: 'sable' }])
    expect(out.state.public.currentIndex).toBe(1)
  })

  it('rejette un joueur qui parle hors de son tour', () => {
    const s = fresh()
    const pasSonTour = s.public.order[1] as PlayerId
    expect(() =>
      imposteurMachine.reduce(s, { type: 'indice', mot: 'x' }, ctx(pasSonTour)),
    ).toThrow(InvalidActionError)
  })

  it('rejette un vote pendant les indices', () => {
    const s = fresh()
    const tour = s.public.order[0] as PlayerId
    expect(() => imposteurMachine.reduce(s, { type: 'vote', suspect: 'b' }, ctx(tour))).toThrow(
      InvalidActionError,
    )
  })

  it('passe au vote une fois tout le monde entendu', () => {
    const s = tousLesIndices(fresh())
    expect(s.public.phase).toBe('vote')
    expect(s.public.indices).toHaveLength(4)
  })

  it('fait boire celui qui reste muet, et laisse une trace', () => {
    const s = fresh()
    const tour = s.public.order[0] as PlayerId
    const out = imposteurMachine.reduce(s, { type: 'timeout' }, ctx(tour, 999_999))

    expect(out.state.public.sips[tour]).toBe(IMPOSTEUR_ABSENT_SIPS)
    expect(out.state.public.indices[0]?.mot).toBe('…')
  })
})

describe('phase du vote', () => {
  function voter(state: ImposteurState, bulletins: Array<[PlayerId, PlayerId]>) {
    let courant = state
    let dernier!: ReturnType<typeof imposteurMachine.reduce>
    for (const [votant, suspect] of bulletins) {
      dernier = imposteurMachine.reduce(courant, { type: 'vote', suspect }, ctx(votant))
      courant = dernier.state
    }
    return dernier
  }

  it('démasque l’imposteur quand il est le plus désigné', () => {
    const s = tousLesIndices(fresh())
    const imp = s.secret.imposteur
    const autres = JOUEURS.filter((j) => j !== imp)

    const out = voter(s, [
      [autres[0] as PlayerId, imp],
      [autres[1] as PlayerId, imp],
      [autres[2] as PlayerId, imp],
      [imp, autres[0] as PlayerId],
    ])

    expect(out.state.public.demasque).toBe(true)
    expect(out.state.public.sips[imp]).toBe(IMPOSTEUR_DEMASQUE_SIPS)
    expect(out.result).toBeDefined()
  })

  it('fait boire tous les innocents quand l’imposteur passe entre les gouttes', () => {
    const s = tousLesIndices(fresh())
    const imp = s.secret.imposteur
    const autres = JOUEURS.filter((j) => j !== imp)
    const bouc = autres[0] as PlayerId

    const out = voter(s, [
      [autres[1] as PlayerId, bouc],
      [autres[2] as PlayerId, bouc],
      [bouc, autres[1] as PlayerId],
      [imp, bouc],
    ])

    expect(out.state.public.demasque).toBe(false)
    expect(out.state.public.sips[imp] ?? 0).toBe(0)
    for (const innocent of autres) {
      expect(out.state.public.sips[innocent]).toBe(IMPOSTEUR_RATE_SIPS)
    }
  })

  it('révèle tout une fois la manche close', () => {
    const s = tousLesIndices(fresh())
    const imp = s.secret.imposteur
    const autres = JOUEURS.filter((j) => j !== imp)
    const out = voter(s, [
      [autres[0] as PlayerId, imp],
      [autres[1] as PlayerId, imp],
      [autres[2] as PlayerId, imp],
      [imp, autres[0] as PlayerId],
    ])

    expect(out.state.public.imposteur).toBe(imp)
    expect(out.state.public.motCommun).toBe(s.secret.motCommun)
    expect(out.state.public.motImposteur).toBe(s.secret.motImposteur)
  })

  it('interdit de s’accuser soi-même', () => {
    const s = tousLesIndices(fresh())
    expect(() => imposteurMachine.reduce(s, { type: 'vote', suspect: 'a' }, ctx('a'))).toThrow(
      InvalidActionError,
    )
  })

  it('interdit de voter deux fois', () => {
    const s = tousLesIndices(fresh())
    const premier = imposteurMachine.reduce(s, { type: 'vote', suspect: 'b' }, ctx('a'))
    expect(() =>
      imposteurMachine.reduce(premier.state, { type: 'vote', suspect: 'c' }, ctx('a')),
    ).toThrow(InvalidActionError)
  })

  it('interdit d’accuser quelqu’un d’extérieur', () => {
    const s = tousLesIndices(fresh())
    expect(() =>
      imposteurMachine.reduce(s, { type: 'vote', suspect: 'inconnu' }, ctx('a')),
    ).toThrow(InvalidActionError)
  })

  it('clôt la manche à l’expiration, en faisant boire les abstentionnistes', () => {
    const s = tousLesIndices(fresh())
    const out = imposteurMachine.reduce(s, { type: 'timeout' }, ctx('a', 999_999))

    expect(out.state.public.phase).toBe('over')
    expect(out.result).toBeDefined()
    for (const j of JOUEURS) {
      expect(out.state.public.sips[j]).toBeGreaterThanOrEqual(IMPOSTEUR_ABSENT_SIPS)
    }
  })
})

describe('actions illégales', () => {
  it('refuse une charge utile malformée', () => {
    expect(() => imposteurMachine.parseAction({ type: 'indice', mot: '' })).toThrow()
    expect(() => imposteurMachine.parseAction({ type: 'indice' })).toThrow()
    expect(() => imposteurMachine.parseAction({ type: 'vote' })).toThrow()
  })

  it('rejette toute action après la fin', () => {
    const s = tousLesIndices(fresh())
    const fini = imposteurMachine.reduce(s, { type: 'timeout' }, ctx('a', 999_999)).state
    expect(() => imposteurMachine.reduce(fini, { type: 'vote', suspect: 'b' }, ctx('a'))).toThrow(
      InvalidActionError,
    )
  })
})
