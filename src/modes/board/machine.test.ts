import { describe, it, expect } from 'vitest'
import { createRng } from '@/engine/rng'
import type { GameResult, PlayerId } from '@/engine/types'
import {
  BET_PENALTY_SIPS,
  BOARD_SIZE,
  CELLS,
  TOURNEE_SIPS,
  type CellKind,
} from './cells'
import {
  applyRound,
  crosses,
  initBoard,
  resolveDuel,
  resolveTournee,
  standings,
  type BoardState,
} from './machine'

const JOUEURS: PlayerId[] = ['a', 'b', 'c', 'd']

function makeBoard(opts: {
  positions?: Partial<Record<PlayerId, number>>
  stars?: Partial<Record<PlayerId, number>>
  distance?: Partial<Record<PlayerId, number>>
  starCell?: number
  totalRounds?: number
  roundIndex?: number
} = {}): BoardState {
  const sips: Record<PlayerId, number> = {}
  for (const id of JOUEURS) sips[id] = 0

  return {
    players: JOUEURS.map((id) => ({
      id,
      position: opts.positions?.[id] ?? 0,
      stars: opts.stars?.[id] ?? 0,
      distance: opts.distance?.[id] ?? 0,
    })),
    // Case volontairement éloignée pour ne pas polluer les tests de déplacement.
    starCell: opts.starCell ?? 12,
    roundIndex: opts.roundIndex ?? 0,
    totalRounds: opts.totalRounds ?? 10,
    sips,
    pendings: [],
    forcedDuel: null,
    log: [],
    finished: false,
  }
}

function result(ranking: PlayerId[][], sips: Record<PlayerId, number> = {}): GameResult {
  return { ranking, sips }
}

const rng = () => createRng('plateau')

function positionOf(state: BoardState, id: PlayerId): number {
  return state.players.find((p) => p.id === id)?.position ?? -1
}

describe('composition de l’anneau', () => {
  it('compte exactement 24 cases', () => {
    expect(CELLS).toHaveLength(BOARD_SIZE)
  })

  it('respecte la répartition prévue', () => {
    const compte = (kind: CellKind) => CELLS.filter((c) => c === kind).length
    expect(compte('neutre')).toBe(12)
    expect(compte('gage')).toBe(4)
    expect(compte('tournee')).toBe(3)
    expect(compte('duel')).toBe(3)
    expect(compte('teleport')).toBe(2)
  })
})

describe('crosses', () => {
  it('détecte une case atteinte', () => {
    expect(crosses(0, 3, 3)).toBe(true)
  })

  it('détecte une case dépassée', () => {
    expect(crosses(0, 3, 2)).toBe(true)
  })

  it('ignore une case non franchie', () => {
    expect(crosses(0, 3, 5)).toBe(false)
    expect(crosses(0, 3, 0)).toBe(false)
  })

  it('gère le passage par zéro', () => {
    expect(crosses(22, 3, 0)).toBe(true)
    expect(crosses(22, 3, 1)).toBe(true)
  })
})

describe('initBoard', () => {
  it('place tout le monde au départ, sans étoile', () => {
    const s = initBoard(JOUEURS, 10, rng())
    expect(s.players.every((p) => p.position === 0 && p.stars === 0)).toBe(true)
    expect(s.roundIndex).toBe(0)
    expect(s.finished).toBe(false)
  })

  it('ne pose jamais l’étoile sur la case de départ', () => {
    for (let i = 0; i < 50; i++) {
      expect(initBoard(JOUEURS, 10, createRng(`etoile-${i}`)).starCell).not.toBe(0)
    }
  })

  it('refuse une partie à un seul joueur ou sans manche', () => {
    expect(() => initBoard(['a'], 10, rng())).toThrow()
    expect(() => initBoard(JOUEURS, 0, rng())).toThrow()
  })
})

describe('déplacements', () => {
  it('donne 3, 2 et 1 case aux trois premiers, rien aux suivants', () => {
    const out = applyRound(
      makeBoard(),
      { participants: JOUEURS, result: result([['a'], ['b'], ['c'], ['d']]), bets: {} },
      rng(),
    )
    expect(positionOf(out, 'a')).toBe(3)
    expect(positionOf(out, 'b')).toBe(2)
    expect(positionOf(out, 'c')).toBe(1)
    expect(positionOf(out, 'd')).toBe(0)
  })

  it('donne le même gain aux ex æquo', () => {
    const out = applyRound(
      makeBoard(),
      { participants: JOUEURS, result: result([['a', 'b'], ['c']]), bets: {} },
      rng(),
    )
    expect(positionOf(out, 'a')).toBe(3)
    expect(positionOf(out, 'b')).toBe(3)
    expect(positionOf(out, 'c')).toBe(2)
  })

  it('boucle sur l’anneau', () => {
    const out = applyRound(
      makeBoard({ positions: { a: 22 } }),
      { participants: JOUEURS, result: result([['a']]), bets: {} },
      rng(),
    )
    expect(positionOf(out, 'a')).toBe(1)
  })

  it('cumule la distance parcourue', () => {
    const un = applyRound(
      makeBoard(),
      { participants: JOUEURS, result: result([['a']]), bets: {} },
      rng(),
    )
    const deux = applyRound(
      un,
      { participants: JOUEURS, result: result([['a']]), bets: {} },
      rng(),
    )
    expect(deux.players.find((p) => p.id === 'a')?.distance).toBe(6)
  })
})

describe('gorgées et paris', () => {
  it('applique les gorgées du mini-jeu', () => {
    const out = applyRound(
      makeBoard(),
      { participants: JOUEURS, result: result([['a'], ['b']], { b: 4 }), bets: {} },
      rng(),
    )
    expect(out.sips['b']).toBe(4)
    expect(out.sips['a']).toBe(0)
  })

  it('fait avancer d’une case le parieur qui a vu juste', () => {
    const out = applyRound(
      makeBoard(),
      { participants: ['a', 'b'], result: result([['a'], ['b']]), bets: { c: 'a' } },
      rng(),
    )
    expect(positionOf(out, 'c')).toBe(1)
    expect(out.sips['c']).toBe(0)
  })

  it('fait boire le parieur qui s’est trompé', () => {
    const out = applyRound(
      makeBoard(),
      { participants: ['a', 'b'], result: result([['a'], ['b']]), bets: { c: 'b' } },
      rng(),
    )
    expect(positionOf(out, 'c')).toBe(0)
    expect(out.sips['c']).toBe(BET_PENALTY_SIPS)
  })

  it('ignore le pari d’un joueur qui participait au mini-jeu', () => {
    const out = applyRound(
      makeBoard(),
      { participants: ['a', 'b'], result: result([['a'], ['b']]), bets: { b: 'b' } },
      rng(),
    )
    // b avance de 2 pour sa 2ᵉ place, pas de 3 grâce à un pari sur lui-même.
    expect(positionOf(out, 'b')).toBe(2)
    expect(out.sips['b']).toBe(0)
  })
})

describe('étoile', () => {
  it('est ramassée quand on l’atteint', () => {
    const out = applyRound(
      makeBoard({ starCell: 3 }),
      { participants: JOUEURS, result: result([['a']]), bets: {} },
      rng(),
    )
    expect(out.players.find((p) => p.id === 'a')?.stars).toBe(1)
  })

  it('est ramassée quand on la dépasse', () => {
    const out = applyRound(
      makeBoard({ starCell: 2 }),
      { participants: JOUEURS, result: result([['a']]), bets: {} },
      rng(),
    )
    expect(out.players.find((p) => p.id === 'a')?.stars).toBe(1)
  })

  it('réapparaît ailleurs après avoir été ramassée', () => {
    const out = applyRound(
      makeBoard({ starCell: 3 }),
      { participants: JOUEURS, result: result([['a']]), bets: {} },
      rng(),
    )
    expect(out.starCell).not.toBe(3)
  })

  it('reste en place si personne ne passe dessus', () => {
    const out = applyRound(
      makeBoard({ starCell: 12 }),
      { participants: JOUEURS, result: result([['a']]), bets: {} },
      rng(),
    )
    expect(out.starCell).toBe(12)
    expect(out.players.find((p) => p.id === 'a')?.stars).toBe(0)
  })

  it('revient au mieux classé quand deux joueurs la franchiraient', () => {
    // a et b partent de 0 ; l'étoile est en 2, franchie par les deux.
    const out = applyRound(
      makeBoard({ starCell: 2 }),
      { participants: JOUEURS, result: result([['a'], ['b']]), bets: {} },
      rng(),
    )
    expect(out.players.find((p) => p.id === 'a')?.stars).toBe(1)
    expect(out.players.find((p) => p.id === 'b')?.stars).toBe(0)
  })
})

describe('effets de case', () => {
  it('une case Tournée met un effet en attente', () => {
    // Depuis la case 3, +3 mène à la case 6 : une Tournée.
    const out = applyRound(
      makeBoard({ positions: { a: 3 } }),
      { participants: JOUEURS, result: result([['a']]), bets: {} },
      rng(),
    )
    expect(out.pendings).toEqual([{ kind: 'tournee', player: 'a', amount: TOURNEE_SIPS }])
  })

  it('une case Duel met un effet en attente', () => {
    // Depuis la case 1, +3 mène à la case 4 : un Duel.
    const out = applyRound(
      makeBoard({ positions: { a: 1 } }),
      { participants: JOUEURS, result: result([['a']]), bets: {} },
      rng(),
    )
    expect(out.pendings).toEqual([{ kind: 'duel', player: 'a' }])
  })

  it('une case Téléportation échange deux pions', () => {
    // Depuis la case 7, +3 mène à la case 10 : une Téléportation.
    const out = applyRound(
      makeBoard({ positions: { a: 7 } }),
      { participants: JOUEURS, result: result([['a']]), bets: {} },
      rng(),
    )
    expect(positionOf(out, 'a')).not.toBe(10)
    expect(out.players.some((p) => p.position === 10)).toBe(true)
  })

  it('une case Gage se résout toute seule, sans attente', () => {
    // Depuis la case 23, +3 mène à la case 2 : un Gage.
    const out = applyRound(
      makeBoard({ positions: { a: 23 }, starCell: 12 }),
      { participants: JOUEURS, result: result([['a']]), bets: {} },
      rng(),
    )
    expect(positionOf(out, 'a')).toBe(2)
    expect(out.pendings).toEqual([])
    expect(out.log.some((l) => l.startsWith('Gage pour a'))).toBe(true)
  })

  it('refuse de lancer une manche tant qu’un effet est en attente', () => {
    const bloque = applyRound(
      makeBoard({ positions: { a: 3 } }),
      { participants: JOUEURS, result: result([['a']]), bets: {} },
      rng(),
    )
    expect(() =>
      applyRound(bloque, { participants: JOUEURS, result: result([['a']]), bets: {} }, rng()),
    ).toThrow()
  })
})

describe('résolution des effets', () => {
  it('distribue les gorgées d’une Tournée', () => {
    const bloque = applyRound(
      makeBoard({ positions: { a: 3 } }),
      { participants: JOUEURS, result: result([['a']]), bets: {} },
      rng(),
    )
    const out = resolveTournee(bloque, 'a', { b: 2, c: 1 })

    expect(out.sips['b']).toBe(2)
    expect(out.sips['c']).toBe(1)
    expect(out.pendings).toEqual([])
  })

  it('exige le total exact', () => {
    const bloque = applyRound(
      makeBoard({ positions: { a: 3 } }),
      { participants: JOUEURS, result: result([['a']]), bets: {} },
      rng(),
    )
    expect(() => resolveTournee(bloque, 'a', { b: 2 })).toThrow()
    expect(() => resolveTournee(bloque, 'a', { b: 5 })).toThrow()
    expect(() => resolveTournee(bloque, 'a', { inconnu: 3 })).toThrow()
  })

  it('programme le duel imposé', () => {
    const bloque = applyRound(
      makeBoard({ positions: { a: 1 } }),
      { participants: JOUEURS, result: result([['a']]), bets: {} },
      rng(),
    )
    const out = resolveDuel(bloque, 'a', 'c')

    expect(out.forcedDuel).toEqual(['a', 'c'])
    expect(out.pendings).toEqual([])
  })

  it('refuse un auto-duel ou un adversaire inconnu', () => {
    const bloque = applyRound(
      makeBoard({ positions: { a: 1 } }),
      { participants: JOUEURS, result: result([['a']]), bets: {} },
      rng(),
    )
    expect(() => resolveDuel(bloque, 'a', 'a')).toThrow()
    expect(() => resolveDuel(bloque, 'a', 'zzz')).toThrow()
  })
})

describe('fin de partie', () => {
  it('se termine après le nombre de manches prévu', () => {
    let s = makeBoard({ totalRounds: 2 })
    s = applyRound(s, { participants: JOUEURS, result: result([['d']]), bets: {} }, rng())
    expect(s.finished).toBe(false)

    s = applyRound(s, { participants: JOUEURS, result: result([['d']]), bets: {} }, rng())
    expect(s.finished).toBe(true)
    expect(s.roundIndex).toBe(2)
  })

  it('n’impose pas de duel sur la dernière manche', () => {
    // Depuis la case 1, +3 mène à la case 4 : un Duel. Mais la partie s'arrête
    // là, donc l'affrontement n'aurait jamais lieu.
    const out = applyRound(
      makeBoard({ positions: { a: 1 }, totalRounds: 1 }),
      { participants: JOUEURS, result: result([['a']]), bets: {} },
      rng(),
    )

    expect(out.finished).toBe(true)
    expect(out.pendings).toEqual([])
    expect(out.log.some((l) => l.includes('la partie s’arrête ici'))).toBe(true)
  })

  it('sert quand même une tournée tombée sur la dernière manche', () => {
    // Une Tournée, elle, se distribue sur-le-champ : rien n'empêche de la boire.
    const out = applyRound(
      makeBoard({ positions: { a: 3 }, totalRounds: 1 }),
      { participants: JOUEURS, result: result([['a']]), bets: {} },
      rng(),
    )

    expect(out.finished).toBe(true)
    expect(out.pendings).toEqual([{ kind: 'tournee', player: 'a', amount: TOURNEE_SIPS }])
  })

  it('refuse une manche supplémentaire une fois terminée', () => {
    let s = makeBoard({ totalRounds: 1 })
    s = applyRound(s, { participants: JOUEURS, result: result([['d']]), bets: {} }, rng())
    expect(() =>
      applyRound(s, { participants: JOUEURS, result: result([['d']]), bets: {} }, rng()),
    ).toThrow()
  })
})

describe('classement', () => {
  it('classe par étoiles avant tout', () => {
    const s = makeBoard({
      stars: { a: 1, b: 3, c: 0, d: 0 },
      distance: { a: 50, b: 2, c: 40, d: 0 },
    })
    expect(standings(s)).toEqual([['b'], ['a'], ['c'], ['d']])
  })

  it('départage à égalité d’étoiles par la distance', () => {
    const s = makeBoard({
      stars: { a: 2, b: 2, c: 2, d: 0 },
      distance: { a: 10, b: 30, c: 20, d: 99 },
    })
    expect(standings(s)).toEqual([['b'], ['c'], ['a'], ['d']])
  })

  it('groupe les parfaits ex æquo', () => {
    const s = makeBoard({
      stars: { a: 1, b: 1, c: 0, d: 0 },
      distance: { a: 12, b: 12, c: 5, d: 5 },
    })
    expect(standings(s)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })
})
