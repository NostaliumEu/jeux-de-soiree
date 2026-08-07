/** Paquet de 52 cartes. Partagé par tous les jeux de cartes. */

export type Suit = '♠' | '♥' | '♦' | '♣'

export type Rank =
  | 'A'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '10'
  | 'J'
  | 'Q'
  | 'K'

export interface Card {
  rank: Rank
  suit: Suit
}

export const SUITS: readonly Suit[] = ['♠', '♥', '♦', '♣']

export const RANKS: readonly Rank[] = [
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
]

export function buildDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit })
    }
  }
  return deck
}

export function isRed(card: Card): boolean {
  return card.suit === '♥' || card.suit === '♦'
}

export function colorOf(card: Card): 'red' | 'black' {
  return isRed(card) ? 'red' : 'black'
}

/** As = 1, 2 à 10 = leur valeur, Valet = 11, Dame = 12, Roi = 13. */
export function cardValue(card: Card): number {
  const index = RANKS.indexOf(card.rank)
  if (index < 0) throw new Error(`Rang inconnu: ${card.rank}`)
  return index + 1
}

export function cardLabel(card: Card): string {
  return `${card.rank}${card.suit}`
}
