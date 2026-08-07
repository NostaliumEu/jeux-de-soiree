import { describe, it, expect } from 'vitest'
import { createRng } from '@/engine/rng'
import { InvalidActionError, type PlayerId, type ReduceContext } from '@/engine/types'
import { construireJeu, estJoker, estPioche, type CarteUno, type Couleur } from './cartes'
import { estJouable, unoMachine, type UnoPublic, type UnoState } from './machine'
import {
  UNO_MAIN_DEPART,
  UNO_PENALITE_UNO_CARTES,
  UNO_PENALITE_UNO_SIPS,
  UNO_SIPS_MAX_CHAINE,
  UNO_SIPS_MAX_FIN,
} from './definition'

const JOUEURS: PlayerId[] = ['a', 'b', 'c']

const c = (couleur: Couleur | null, valeur: CarteUno['valeur']): CarteUno => ({ couleur, valeur })

function ctx(actor: PlayerId, now = 1_000): ReduceContext {
  return { rng: createRng(`uno-${actor}-${now}`), now, mode: 'free', actor }
}

function makeState(opts: {
  mains: Record<PlayerId, CarteUno[]>
  dessus?: CarteUno
  couleur?: Couleur
  currentIndex?: number
  sens?: 1 | -1
  pileEnAttente?: number
  chaine?: number
  chaineEstPlus4?: boolean
  talon?: CarteUno[]
  order?: PlayerId[]
}): UnoState {
  const order = opts.order ?? JOUEURS
  const pub: UnoPublic = {
    phase: 'tour',
    deadlineAt: 60_000,
    order: [...order],
    currentIndex: opts.currentIndex ?? 0,
    sens: opts.sens ?? 1,
    dessus: opts.dessus ?? c('rouge', '5'),
    couleur: opts.couleur ?? 'rouge',
    mains: Object.fromEntries(order.map((id) => [id, opts.mains[id]?.length ?? 0])),
    pileEnAttente: opts.pileEnAttente ?? 0,
    chaine: opts.chaine ?? 0,
    chaineEstPlus4: opts.chaineEstPlus4 ?? false,
    gagnant: null,
    sips: Object.fromEntries(order.map((id) => [id, 0])),
    cartesAuTalon: (opts.talon ?? []).length,
    journal: [],
  }
  return {
    public: pub,
    secret: {
      mains: opts.mains,
      talon: opts.talon ?? Array.from({ length: 30 }, () => c('vert', '3')),
      defausse: [],
      piochee: null,
    },
  }
}

describe('le paquet', () => {
  it('compte 108 cartes', () => {
    expect(construireJeu()).toHaveLength(108)
  })

  it('contient quatre jokers et quatre +4', () => {
    const jeu = construireJeu()
    expect(jeu.filter((x) => x.valeur === 'joker')).toHaveLength(4)
    expect(jeu.filter((x) => x.valeur === 'plus4')).toHaveLength(4)
  })

  it('contient un seul 0 et deux 7 par couleur', () => {
    const jeu = construireJeu()
    expect(jeu.filter((x) => x.couleur === 'rouge' && x.valeur === '0')).toHaveLength(1)
    expect(jeu.filter((x) => x.couleur === 'rouge' && x.valeur === '7')).toHaveLength(2)
    expect(jeu.filter((x) => x.couleur === 'bleu' && x.valeur === 'plus2')).toHaveLength(2)
  })

  it('classe correctement les cartes spéciales', () => {
    expect(estPioche(c('rouge', 'plus2'))).toBe(true)
    expect(estPioche(c(null, 'plus4'))).toBe(true)
    expect(estPioche(c('rouge', '5'))).toBe(false)
    expect(estJoker(c(null, 'joker'))).toBe(true)
    expect(estJoker(c('rouge', 'passe'))).toBe(false)
  })
})

describe('ce qui est posable, hors chaîne', () => {
  const dessus = c('rouge', '5')

  it('accepte la même couleur', () => {
    expect(estJouable(c('rouge', '9'), 'rouge', dessus, 0, false)).toBe(true)
  })

  it('accepte le même symbole', () => {
    expect(estJouable(c('bleu', '5'), 'rouge', dessus, 0, false)).toBe(true)
  })

  it('refuse une carte sans rapport', () => {
    expect(estJouable(c('bleu', '9'), 'rouge', dessus, 0, false)).toBe(false)
  })

  it('accepte toujours les jokers', () => {
    expect(estJouable(c(null, 'joker'), 'rouge', dessus, 0, false)).toBe(true)
    expect(estJouable(c(null, 'plus4'), 'rouge', dessus, 0, false)).toBe(true)
  })

  it('suit la couleur choisie après un joker, pas celle du dessus', () => {
    expect(estJouable(c('vert', '2'), 'vert', c(null, 'joker'), 0, false)).toBe(true)
    expect(estJouable(c('rouge', '2'), 'vert', c(null, 'joker'), 0, false)).toBe(false)
  })
})

describe('les cumuls — la règle demandée', () => {
  const dessus = c('rouge', 'plus2')

  it('un +2 se pose sur un +2', () => {
    expect(estJouable(c('bleu', 'plus2'), 'rouge', dessus, 2, false)).toBe(true)
  })

  it('un +4 se pose sur un +2', () => {
    expect(estJouable(c(null, 'plus4'), 'rouge', dessus, 2, false)).toBe(true)
  })

  it('un +4 se pose sur un +4', () => {
    expect(estJouable(c(null, 'plus4'), 'rouge', c(null, 'plus4'), 4, true)).toBe(true)
  })

  it('un +2 NE se pose PAS sur un +4', () => {
    expect(estJouable(c('bleu', 'plus2'), 'rouge', c(null, 'plus4'), 4, true)).toBe(false)
  })

  it('rien d’autre ne passe pendant une chaîne', () => {
    expect(estJouable(c('rouge', '5'), 'rouge', dessus, 2, false)).toBe(false)
    expect(estJouable(c(null, 'joker'), 'rouge', dessus, 2, false)).toBe(false)
    expect(estJouable(c('rouge', 'passe'), 'rouge', dessus, 2, false)).toBe(false)
  })
})

describe('poser une carte', () => {
  it('passe la main au joueur suivant', () => {
    const s = makeState({ mains: { a: [c('rouge', '7')], b: [], c: [] } })
    const out = unoMachine.reduce(s, { type: 'play', index: 0, uno: true }, ctx('a'))
    expect(out.state.public.currentIndex).toBe(1)
    expect(out.state.public.dessus).toEqual(c('rouge', '7'))
  })

  it('refuse une carte qui ne va pas', () => {
    const s = makeState({ mains: { a: [c('bleu', '9')], b: [], c: [] } })
    expect(() => unoMachine.reduce(s, { type: 'play', index: 0 }, ctx('a'))).toThrow(
      InvalidActionError,
    )
  })

  it('refuse un joueur qui n’est pas de tour', () => {
    const s = makeState({ mains: { a: [c('rouge', '7')], b: [c('rouge', '8')], c: [] } })
    expect(() => unoMachine.reduce(s, { type: 'play', index: 0 }, ctx('b'))).toThrow(
      InvalidActionError,
    )
  })

  it('exige une couleur avec un joker', () => {
    const s = makeState({ mains: { a: [c(null, 'joker'), c('vert', '1')], b: [], c: [] } })
    expect(() => unoMachine.reduce(s, { type: 'play', index: 0 }, ctx('a'))).toThrow(
      InvalidActionError,
    )
  })

  it('applique la couleur choisie', () => {
    const s = makeState({ mains: { a: [c(null, 'joker'), c('vert', '1')], b: [], c: [] } })
    const out = unoMachine.reduce(s, { type: 'play', index: 0, couleur: 'bleu' }, ctx('a'))
    expect(out.state.public.couleur).toBe('bleu')
  })
})

describe('effets des cartes', () => {
  it('« passe » saute le joueur suivant', () => {
    const s = makeState({ mains: { a: [c('rouge', 'passe'), c('vert', '1')], b: [], c: [] } })
    const out = unoMachine.reduce(s, { type: 'play', index: 0 }, ctx('a'))
    expect(out.state.public.currentIndex).toBe(2)
  })

  it('« inversion » retourne le sens de jeu', () => {
    const s = makeState({ mains: { a: [c('rouge', 'inversion'), c('vert', '1')], b: [], c: [] } })
    const out = unoMachine.reduce(s, { type: 'play', index: 0 }, ctx('a'))
    expect(out.state.public.sens).toBe(-1)
    expect(out.state.public.currentIndex).toBe(2)
  })

  it('à deux joueurs, « inversion » vaut « passe »', () => {
    const s = makeState({
      order: ['a', 'b'],
      mains: { a: [c('rouge', 'inversion'), c('vert', '1')], b: [] },
    })
    const out = unoMachine.reduce(s, { type: 'play', index: 0 }, ctx('a'))
    expect(out.state.public.sens).toBe(1)
    expect(out.state.public.currentIndex).toBe(0)
  })
})

describe('chaîne de pioches', () => {
  it('un +2 met deux cartes en attente', () => {
    const s = makeState({ mains: { a: [c('rouge', 'plus2'), c('vert', '1')], b: [], c: [] } })
    const out = unoMachine.reduce(s, { type: 'play', index: 0 }, ctx('a'))

    expect(out.state.public.pileEnAttente).toBe(2)
    expect(out.state.public.chaine).toBe(1)
    expect(out.state.public.chaineEstPlus4).toBe(false)
  })

  it('les +2 s’empilent', () => {
    const s = makeState({
      mains: { a: [], b: [c('bleu', 'plus2'), c('vert', '1')], c: [] },
      dessus: c('rouge', 'plus2'),
      currentIndex: 1,
      pileEnAttente: 2,
      chaine: 1,
    })
    const out = unoMachine.reduce(s, { type: 'play', index: 0 }, ctx('b'))

    expect(out.state.public.pileEnAttente).toBe(4)
    expect(out.state.public.chaine).toBe(2)
  })

  it('un +4 relève un +2 et durcit la chaîne', () => {
    const s = makeState({
      mains: { a: [], b: [c(null, 'plus4'), c('vert', '1')], c: [] },
      dessus: c('rouge', 'plus2'),
      currentIndex: 1,
      pileEnAttente: 2,
      chaine: 1,
    })
    const out = unoMachine.reduce(s, { type: 'play', index: 0, couleur: 'vert' }, ctx('b'))

    expect(out.state.public.pileEnAttente).toBe(6)
    expect(out.state.public.chaineEstPlus4).toBe(true)
    expect(out.state.public.couleur).toBe('vert')
  })

  it('un +2 sur un +4 est refusé, avec un message clair', () => {
    const s = makeState({
      mains: { a: [], b: [c('bleu', 'plus2'), c('vert', '1')], c: [] },
      dessus: c(null, 'plus4'),
      currentIndex: 1,
      pileEnAttente: 4,
      chaine: 1,
      chaineEstPlus4: true,
    })

    expect(() => unoMachine.reduce(s, { type: 'play', index: 0 }, ctx('b'))).toThrow(
      /Seul un \+4 peut relever un \+4/,
    )
  })

  it('celui qui ramasse prend toutes les cartes et boit la chaîne', () => {
    const s = makeState({
      mains: { a: [], b: [c('vert', '1')], c: [] },
      currentIndex: 1,
      pileEnAttente: 6,
      chaine: 3,
      chaineEstPlus4: true,
    })
    const out = unoMachine.reduce(s, { type: 'draw' }, ctx('b'))

    expect(out.state.public.mains['b']).toBe(7)
    expect(out.state.public.sips['b']).toBe(3)
    expect(out.state.public.pileEnAttente).toBe(0)
    expect(out.state.public.chaine).toBe(0)
    expect(out.state.public.chaineEstPlus4).toBe(false)
    expect(out.state.public.currentIndex).toBe(2)
  })

  it('plafonne les gorgées d’une chaîne démesurée', () => {
    const s = makeState({
      mains: { a: [], b: [], c: [] },
      currentIndex: 1,
      pileEnAttente: 20,
      chaine: 9,
      chaineEstPlus4: true,
    })
    const out = unoMachine.reduce(s, { type: 'draw' }, ctx('b'))
    expect(out.state.public.sips['b']).toBe(UNO_SIPS_MAX_CHAINE)
  })
})

describe('piocher hors chaîne', () => {
  it('propose de jouer la carte piochée si elle passe', () => {
    const s = makeState({
      mains: { a: [], b: [], c: [] },
      talon: [c('rouge', '9')],
    })
    const out = unoMachine.reduce(s, { type: 'draw' }, ctx('a'))

    expect(out.state.public.phase).toBe('apres-pioche')
    expect(out.state.public.currentIndex).toBe(0)
    expect(unoMachine.view(out.state, 'a').privateView).toMatchObject({
      piochee: c('rouge', '9'),
    })
  })

  it('passe la main si la carte piochée ne passe pas', () => {
    const s = makeState({ mains: { a: [], b: [], c: [] }, talon: [c('bleu', '9')] })
    const out = unoMachine.reduce(s, { type: 'draw' }, ctx('a'))

    expect(out.state.public.phase).toBe('tour')
    expect(out.state.public.currentIndex).toBe(1)
  })

  it('permet de renoncer après avoir pioché', () => {
    const s = makeState({ mains: { a: [], b: [], c: [] }, talon: [c('rouge', '9')] })
    const pioche = unoMachine.reduce(s, { type: 'draw' }, ctx('a'))
    const out = unoMachine.reduce(pioche.state, { type: 'passer' }, ctx('a'))

    expect(out.state.public.phase).toBe('tour')
    expect(out.state.public.currentIndex).toBe(1)
  })

  it('remélange la défausse quand le talon est vide', () => {
    const s: UnoState = {
      ...makeState({ mains: { a: [], b: [], c: [] }, talon: [] }),
    }
    s.secret.defausse = [c('rouge', '9'), c('bleu', '4')]
    const out = unoMachine.reduce(s, { type: 'draw' }, ctx('a'))
    expect(out.state.public.mains['a']).toBe(1)
  })
})

describe('annonce du UNO', () => {
  it('sanctionne qui descend à une carte sans l’annoncer', () => {
    const s = makeState({ mains: { a: [c('rouge', '7'), c('vert', '1')], b: [], c: [] } })
    const out = unoMachine.reduce(s, { type: 'play', index: 0 }, ctx('a'))

    expect(out.state.public.mains['a']).toBe(1 + UNO_PENALITE_UNO_CARTES)
    expect(out.state.public.sips['a']).toBe(UNO_PENALITE_UNO_SIPS)
  })

  it('épargne qui l’annonce', () => {
    const s = makeState({ mains: { a: [c('rouge', '7'), c('vert', '1')], b: [], c: [] } })
    const out = unoMachine.reduce(s, { type: 'play', index: 0, uno: true }, ctx('a'))

    expect(out.state.public.mains['a']).toBe(1)
    expect(out.state.public.sips['a']).toBe(0)
  })

  it('ne sanctionne pas quand il reste plus d’une carte', () => {
    const s = makeState({
      mains: { a: [c('rouge', '7'), c('vert', '1'), c('vert', '2')], b: [], c: [] },
    })
    const out = unoMachine.reduce(s, { type: 'play', index: 0 }, ctx('a'))
    expect(out.state.public.sips['a']).toBe(0)
  })
})

describe('victoire', () => {
  it('la dernière carte posée met fin à la partie', () => {
    const s = makeState({
      mains: { a: [c('rouge', '7')], b: [c('bleu', '1'), c('bleu', '2')], c: [c('vert', '3')] },
    })
    const out = unoMachine.reduce(s, { type: 'play', index: 0 }, ctx('a'))

    expect(out.state.public.phase).toBe('over')
    expect(out.state.public.gagnant).toBe('a')
    expect(out.result?.ranking).toEqual([['a'], ['c'], ['b']])
  })

  it('fait boire chacun selon les cartes qui lui restent', () => {
    const s = makeState({
      mains: { a: [c('rouge', '7')], b: [c('bleu', '1'), c('bleu', '2')], c: [c('vert', '3')] },
    })
    const out = unoMachine.reduce(s, { type: 'play', index: 0 }, ctx('a'))

    expect(out.result?.sips['a']).toBe(0)
    expect(out.result?.sips['b']).toBe(2)
    expect(out.result?.sips['c']).toBe(1)
  })

  it('plafonne la sanction finale', () => {
    const grosseMain = Array.from({ length: 20 }, () => c('bleu', '1'))
    const s = makeState({ mains: { a: [c('rouge', '7')], b: grosseMain, c: [] } })
    const out = unoMachine.reduce(s, { type: 'play', index: 0 }, ctx('a'))
    expect(out.result?.sips['b']).toBe(UNO_SIPS_MAX_FIN)
  })

  it('rejette toute action après la victoire', () => {
    const s = makeState({ mains: { a: [c('rouge', '7')], b: [c('bleu', '1')], c: [] } })
    const fini = unoMachine.reduce(s, { type: 'play', index: 0 }, ctx('a')).state
    expect(() => unoMachine.reduce(fini, { type: 'draw' }, ctx('b'))).toThrow(InvalidActionError)
  })
})

describe('distribution et secret', () => {
  it('donne sept cartes à chacun et démarre sur un chiffre', () => {
    const s = unoMachine.init({
      participants: JOUEURS,
      rng: createRng('uno-init'),
      now: 0,
      mode: 'free',
    })

    for (const j of JOUEURS) expect(s.public.mains[j]).toBe(UNO_MAIN_DEPART)
    expect(estJoker(s.public.dessus)).toBe(false)
    expect(estPioche(s.public.dessus)).toBe(false)
    expect(['passe', 'inversion']).not.toContain(s.public.dessus.valeur)
  })

  it('ne montre à chacun que sa propre main', () => {
    const s = unoMachine.init({
      participants: JOUEURS,
      rng: createRng('uno-secret'),
      now: 0,
      mode: 'free',
    })

    const vueA = unoMachine.view(s, 'a').privateView as { main: CarteUno[] }
    expect(vueA.main).toEqual(s.secret.mains['a'])
    expect(JSON.stringify(unoMachine.view(s, 'a').publicView)).not.toContain('"main"')
  })

  it('n’expose publiquement que le nombre de cartes', () => {
    const s = unoMachine.init({
      participants: JOUEURS,
      rng: createRng('uno-compte'),
      now: 0,
      mode: 'free',
    })
    expect(s.public.mains).toEqual({ a: 7, b: 7, c: 7 })
  })

  it('refuse un seul joueur', () => {
    expect(() =>
      unoMachine.init({ participants: ['a'], rng: createRng('x'), now: 0, mode: 'free' }),
    ).toThrow()
  })
})

describe('expiration', () => {
  it('fait piocher le joueur absent et passe la main', () => {
    const s = makeState({ mains: { a: [], b: [], c: [] }, talon: [c('rouge', '9')] })
    const out = unoMachine.reduce(s, { type: 'timeout' }, ctx('a', 999_999))

    expect(out.state.public.currentIndex).toBe(1)
    expect(out.state.public.phase).toBe('tour')
  })

  it('fait ramasser la chaîne au joueur absent', () => {
    const s = makeState({
      mains: { a: [], b: [], c: [] },
      pileEnAttente: 4,
      chaine: 2,
    })
    const out = unoMachine.reduce(s, { type: 'timeout' }, ctx('a', 999_999))

    expect(out.state.public.mains['a']).toBe(4)
    expect(out.state.public.sips['a']).toBe(2)
  })

  it('refuse une expiration réclamée trop tôt', () => {
    const s = makeState({ mains: { a: [], b: [], c: [] } })
    expect(() => unoMachine.reduce(s, { type: 'timeout' }, ctx('a', 100))).toThrow(
      InvalidActionError,
    )
  })
})
