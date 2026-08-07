import { describe, it, expect } from 'vitest'
import { buildDeck, cardValue, colorOf, isRed } from './cards'

describe('buildDeck', () => {
  it('contient 52 cartes uniques', () => {
    const deck = buildDeck()
    expect(deck).toHaveLength(52)
    expect(new Set(deck.map((c) => `${c.rank}${c.suit}`)).size).toBe(52)
  })

  it('contient 26 rouges et 26 noires', () => {
    const deck = buildDeck()
    expect(deck.filter(isRed)).toHaveLength(26)
    expect(deck.filter((c) => !isRed(c))).toHaveLength(26)
  })
})

describe('cardValue', () => {
  it('mappe As sur 1 et Roi sur 13', () => {
    expect(cardValue({ rank: 'A', suit: '♠' })).toBe(1)
    expect(cardValue({ rank: 'K', suit: '♠' })).toBe(13)
  })

  it('mappe les figures sur 11, 12, 13', () => {
    expect(cardValue({ rank: 'J', suit: '♥' })).toBe(11)
    expect(cardValue({ rank: 'Q', suit: '♥' })).toBe(12)
    expect(cardValue({ rank: 'K', suit: '♥' })).toBe(13)
  })

  it('mappe les chiffres sur eux-mêmes', () => {
    expect(cardValue({ rank: '7', suit: '♦' })).toBe(7)
    expect(cardValue({ rank: '10', suit: '♦' })).toBe(10)
  })
})

describe('colorOf', () => {
  it('classe cœur et carreau en rouge', () => {
    expect(colorOf({ rank: 'A', suit: '♥' })).toBe('red')
    expect(colorOf({ rank: 'A', suit: '♦' })).toBe('red')
  })

  it('classe pique et trèfle en noir', () => {
    expect(colorOf({ rank: 'A', suit: '♠' })).toBe('black')
    expect(colorOf({ rank: 'A', suit: '♣' })).toBe('black')
  })
})
