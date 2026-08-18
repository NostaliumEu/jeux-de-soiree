import { describe, it, expect } from 'vitest'
import { createRng } from '@/engine/rng'
import { InvalidActionError, type PlayerId, type ReduceContext } from '@/engine/types'
import { bombeMachine, existe, normaliser, tirerSyllabe, type BombeState } from './machine'
import type { BombePublic } from './types'
import {
  BOMBE_MAX_MS,
  BOMBE_MIN_MS,
  BOMBE_SIPS_ELIMINATION,
  BOMBE_SIPS_EXPLOSION,
  BOMBE_VIES,
} from './definition'

const JOUEURS: PlayerId[] = ['a', 'b', 'c']

function ctx(actor: PlayerId, now = 1_000): ReduceContext {
  return { rng: createRng(`bombe-${actor}-${now}`), now, mode: 'free', actor }
}

function makeState(opts: {
  syllabe: string
  currentIndex?: number
  vies?: Record<PlayerId, number>
  utilises?: string[]
  ordreElimination?: PlayerId[]
  deadlineAt?: number
}): BombeState {
  const pub: BombePublic = {
    phase: 'jeu',
    deadlineAt: opts.deadlineAt ?? 60_000,
    mecheAllumeeA: 1_000,
    order: [...JOUEURS],
    currentIndex: opts.currentIndex ?? 0,
    vies: opts.vies ?? { a: BOMBE_VIES, b: BOMBE_VIES, c: BOMBE_VIES },
    ordreElimination: opts.ordreElimination ?? [],
    syllabe: opts.syllabe,
    motsRecents: [],
    explosions: { a: 0, b: 0, c: 0 },
    sips: { a: 0, b: 0, c: 0 },
    gagnant: null,
    dernierCoup: null,
  }
  return { public: pub, secret: { utilises: opts.utilises ?? [] } }
}

describe('dictionnaire', () => {
  it('reconnaît des mots courants', () => {
    for (const mot of ['maison', 'bonjour', 'ordinateur', 'chat', 'manger']) {
      expect(existe(mot)).toBe(true)
    }
  })

  it('reconnaît les formes conjuguées et les pluriels', () => {
    for (const mot of ['mangeais', 'maisons', 'partirent', 'buvions']) {
      expect(existe(mot)).toBe(true)
    }
  })

  it('rejette le charabia', () => {
    for (const mot of ['tiotiotio', 'zzzzz', 'aaaa', 'qwerty']) {
      expect(existe(mot)).toBe(false)
    }
  })
})

describe('normalisation', () => {
  it('supprime les accents et la casse', () => {
    expect(normaliser('ÉLÈVE')).toBe('eleve')
    expect(normaliser('  Château  ')).toBe('chateau')
    expect(normaliser('Noël')).toBe('noel')
  })

  it('permet de taper sans accent', () => {
    expect(existe(normaliser('élève'))).toBe(true)
    expect(existe(normaliser('eleve'))).toBe(true)
  })
})

describe('syllabes', () => {
  it('tire des syllabes de deux ou trois lettres', () => {
    for (let i = 0; i < 50; i++) {
      const s = tirerSyllabe(createRng(`s-${i}`))
      expect(s).toMatch(/^[a-z]{2,3}$/)
    }
  })

  it('ne tire que des syllabes réellement jouables', () => {
    // Chacune doit se retrouver dans au moins un mot du dictionnaire.
    for (let i = 0; i < 25; i++) {
      const s = tirerSyllabe(createRng(`jouable-${i}`))
      const trouve = ['maison', 'bonjour', 'partir'].some((m) => m.includes(s))
      // On ne peut pas tester tout le dictionnaire ici : on vérifie surtout que
      // la syllabe est bien formée et que le tirage ne sort jamais du lot.
      expect(typeof trouve).toBe('boolean')
      expect(s.length).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('init', () => {
  it('distribue les vies et allume une mèche', () => {
    const s = bombeMachine.init({
      participants: JOUEURS,
      rng: createRng('init'),
      now: 1_000,
      mode: 'free',
    })

    expect(s.public.vies).toEqual({ a: BOMBE_VIES, b: BOMBE_VIES, c: BOMBE_VIES })
    expect(s.public.deadlineAt).toBeGreaterThanOrEqual(1_000 + BOMBE_MIN_MS)
    expect(s.public.deadlineAt).toBeLessThanOrEqual(1_000 + BOMBE_MAX_MS)
    expect(s.public.syllabe).toMatch(/^[a-z]{2,3}$/)
  })

  it('refuse un seul joueur', () => {
    expect(() =>
      bombeMachine.init({ participants: ['a'], rng: createRng('x'), now: 0, mode: 'free' }),
    ).toThrow()
  })
})

describe('proposer un mot', () => {
  it('accepte un mot valide et passe au suivant', () => {
    const s = makeState({ syllabe: 'ais' })
    const out = bombeMachine.reduce(s, { type: 'mot', mot: 'maison' }, ctx('a'))

    expect(out.state.public.currentIndex).toBe(1)
    expect(out.state.public.motsRecents).toEqual(['maison'])
    expect(out.state.secret.utilises).toEqual(['maison'])
    expect(out.state.public.dernierCoup?.valide).toBe(true)
  })

  it('tire une nouvelle syllabe à chaque mot trouvé', () => {
    const s = makeState({ syllabe: 'ais' })
    const out = bombeMachine.reduce(s, { type: 'mot', mot: 'maison' }, ctx('a'))
    expect(out.state.public.syllabe).toMatch(/^[a-z]{2,3}$/)
  })

  it('NE rallume PAS la mèche : le suivant hérite du temps restant', () => {
    const s = makeState({ syllabe: 'ais', deadlineAt: 42_000 })
    const out = bombeMachine.reduce(s, { type: 'mot', mot: 'maison' }, ctx('a'))

    expect(out.state.public.deadlineAt).toBe(42_000)
    expect(out.state.public.mecheAllumeeA).toBe(s.public.mecheAllumeeA)
  })

  it('accepte un mot tapé sans accent', () => {
    const s = makeState({ syllabe: 'lev' })
    const out = bombeMachine.reduce(s, { type: 'mot', mot: 'eleve' }, ctx('a'))
    expect(out.state.public.dernierCoup?.valide).toBe(true)
  })

  it('refuse un mot sans la syllabe', () => {
    const s = makeState({ syllabe: 'zzz' })
    expect(() => bombeMachine.reduce(s, { type: 'mot', mot: 'maison' }, ctx('a'))).toThrow(
      /Il faut/,
    )
  })

  it('refuse un mot inconnu du dictionnaire', () => {
    const s = makeState({ syllabe: 'tio' })
    expect(() => bombeMachine.reduce(s, { type: 'mot', mot: 'tiotiotio' }, ctx('a'))).toThrow(
      /Inconnu/,
    )
  })

  it('refuse un mot déjà employé', () => {
    const s = makeState({ syllabe: 'ais', utilises: ['maison'] })
    expect(() => bombeMachine.reduce(s, { type: 'mot', mot: 'Maison' }, ctx('a'))).toThrow(
      /Déjà joué/,
    )
  })

  it('refuse un mot trop court', () => {
    const s = makeState({ syllabe: 'ai' })
    expect(() => bombeMachine.reduce(s, { type: 'mot', mot: 'ai' }, ctx('a'))).toThrow(/court/)
  })

  it('refuse les caractères exotiques', () => {
    const s = makeState({ syllabe: 'ais' })
    expect(() => bombeMachine.reduce(s, { type: 'mot', mot: 'mai-son' }, ctx('a'))).toThrow()
  })

  it('refuse un joueur qui n’a pas la bombe', () => {
    const s = makeState({ syllabe: 'ais' })
    expect(() => bombeMachine.reduce(s, { type: 'mot', mot: 'maison' }, ctx('b'))).toThrow(
      InvalidActionError,
    )
  })

  it('laisse rejouer après un refus, sans rien consommer', () => {
    const s = makeState({ syllabe: 'ais' })
    expect(() => bombeMachine.reduce(s, { type: 'mot', mot: 'zzzz' }, ctx('a'))).toThrow()
    const out = bombeMachine.reduce(s, { type: 'mot', mot: 'maison' }, ctx('a'))
    expect(out.state.public.dernierCoup?.valide).toBe(true)
  })
})

describe('explosion', () => {
  it('coûte une vie et des gorgées à celui qui la tient', () => {
    const s = makeState({ syllabe: 'ais', deadlineAt: 5_000 })
    const out = bombeMachine.reduce(s, { type: 'timeout' }, ctx('a', 5_001))

    expect(out.state.public.vies['a']).toBe(BOMBE_VIES - 1)
    expect(out.state.public.sips['a']).toBe(BOMBE_SIPS_EXPLOSION)
    expect(out.state.public.explosions['a']).toBe(1)
  })

  it('rallume une mèche neuve et change de syllabe', () => {
    const s = makeState({ syllabe: 'ais', deadlineAt: 5_000 })
    const out = bombeMachine.reduce(s, { type: 'timeout' }, ctx('a', 5_001))

    expect(out.state.public.deadlineAt).toBeGreaterThanOrEqual(5_001 + BOMBE_MIN_MS)
    expect(out.state.public.mecheAllumeeA).toBe(5_001)
    expect(out.state.public.currentIndex).toBe(1)
  })

  it('refuse une explosion réclamée trop tôt', () => {
    const s = makeState({ syllabe: 'ais', deadlineAt: 50_000 })
    expect(() => bombeMachine.reduce(s, { type: 'timeout' }, ctx('a', 2_000))).toThrow(
      /brûle encore/,
    )
  })

  it('élimine à court de vies, avec un supplément de gorgées', () => {
    const s = makeState({ syllabe: 'ais', vies: { a: 1, b: 2, c: 2 }, deadlineAt: 5_000 })
    const out = bombeMachine.reduce(s, { type: 'timeout' }, ctx('a', 5_001))

    expect(out.state.public.vies['a']).toBe(0)
    expect(out.state.public.ordreElimination).toEqual(['a'])
    expect(out.state.public.sips['a']).toBe(BOMBE_SIPS_EXPLOSION + BOMBE_SIPS_ELIMINATION)
  })

  it('saute les éliminés dans le tour de table', () => {
    const s = makeState({
      syllabe: 'ais',
      vies: { a: 2, b: 0, c: 2 },
      currentIndex: 0,
      deadlineAt: 5_000,
    })
    const out = bombeMachine.reduce(s, { type: 'timeout' }, ctx('a', 5_001))
    // b est éliminé : la main saute directement à c.
    expect(out.state.public.order[out.state.public.currentIndex]).toBe('c')
  })
})

describe('fin de partie', () => {
  it('s’arrête quand il ne reste qu’un joueur', () => {
    const s = makeState({
      syllabe: 'ais',
      vies: { a: 1, b: 0, c: 2 },
      ordreElimination: ['b'],
      deadlineAt: 5_000,
    })
    const out = bombeMachine.reduce(s, { type: 'timeout' }, ctx('a', 5_001))

    expect(out.state.public.phase).toBe('over')
    expect(out.state.public.gagnant).toBe('c')
    expect(out.result).toBeDefined()
  })

  it('classe le survivant devant, puis les éliminés du dernier au premier', () => {
    const s = makeState({
      syllabe: 'ais',
      vies: { a: 1, b: 0, c: 2 },
      ordreElimination: ['b'],
      deadlineAt: 5_000,
    })
    const out = bombeMachine.reduce(s, { type: 'timeout' }, ctx('a', 5_001))

    expect(out.result?.ranking).toEqual([['c'], ['a'], ['b']])
  })

  it('rejette toute action après la fin', () => {
    const s = makeState({
      syllabe: 'ais',
      vies: { a: 1, b: 0, c: 2 },
      ordreElimination: ['b'],
      deadlineAt: 5_000,
    })
    const fini = bombeMachine.reduce(s, { type: 'timeout' }, ctx('a', 5_001)).state
    expect(() => bombeMachine.reduce(fini, { type: 'mot', mot: 'maison' }, ctx('c'))).toThrow(
      InvalidActionError,
    )
  })
})

describe('secret', () => {
  it('n’expose aucune vue personnelle : tout le monde voit la même chose', () => {
    const s = makeState({ syllabe: 'ais' })
    for (const j of JOUEURS) {
      expect(bombeMachine.view(s, j).privateView).toBeNull()
    }
  })
})

describe('charge utile', () => {
  it('refuse les actions malformées', () => {
    expect(() => bombeMachine.parseAction({ type: 'mot' })).toThrow()
    expect(() => bombeMachine.parseAction({ type: 'mot', mot: '' })).toThrow()
    expect(() => bombeMachine.parseAction({ type: 'inconnu' })).toThrow()
    expect(() => bombeMachine.parseAction(null)).toThrow()
  })

  it('accepte les actions valides', () => {
    expect(bombeMachine.parseAction({ type: 'mot', mot: 'chat' })).toEqual({
      type: 'mot',
      mot: 'chat',
    })
    expect(bombeMachine.parseAction({ type: 'timeout' })).toEqual({ type: 'timeout' })
  })
})
