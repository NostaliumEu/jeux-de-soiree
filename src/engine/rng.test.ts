import { describe, it, expect } from 'vitest'
import { createRng, shuffle } from './rng'

describe('createRng', () => {
  it('rend la même séquence pour la même graine', () => {
    const a = createRng('graine-1')
    const b = createRng('graine-1')
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()])
  })

  it('rend des séquences différentes pour des graines différentes', () => {
    expect(createRng('a').next()).not.toEqual(createRng('b').next())
  })

  it('rend des valeurs dans [0, 1)', () => {
    const rng = createRng('bornes')
    for (let i = 0; i < 500; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('intRange respecte les bornes incluses', () => {
    const rng = createRng('int')
    const vus = new Set<number>()
    for (let i = 0; i < 500; i++) {
      const v = rng.intRange(3, 7)
      expect(v).toBeGreaterThanOrEqual(3)
      expect(v).toBeLessThanOrEqual(7)
      vus.add(v)
    }
    // les deux bornes doivent être atteignables
    expect(vus.has(3)).toBe(true)
    expect(vus.has(7)).toBe(true)
  })

  it('intRange accepte une plage d’un seul élément', () => {
    expect(createRng('un').intRange(4, 4)).toBe(4)
  })

  it('pick jette sur une liste vide', () => {
    expect(() => createRng('vide').pick([])).toThrow()
  })
})

describe('shuffle', () => {
  it('conserve tous les éléments', () => {
    const out = shuffle([1, 2, 3, 4, 5], createRng('s'))
    expect([...out].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('ne mute pas le tableau source', () => {
    const src = [1, 2, 3, 4, 5]
    shuffle(src, createRng('s'))
    expect(src).toEqual([1, 2, 3, 4, 5])
  })

  it('est déterministe à graine égale', () => {
    const a = shuffle([1, 2, 3, 4, 5, 6, 7, 8], createRng('k'))
    const b = shuffle([1, 2, 3, 4, 5, 6, 7, 8], createRng('k'))
    expect(a).toEqual(b)
  })

  it('mélange réellement', () => {
    const src = Array.from({ length: 52 }, (_, i) => i)
    expect(shuffle(src, createRng('vrai-melange'))).not.toEqual(src)
  })
})
