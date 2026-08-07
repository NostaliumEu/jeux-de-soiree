/** Modèle de cartes du UNO. */

export type Couleur = 'rouge' | 'jaune' | 'vert' | 'bleu'

export type Valeur =
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'passe'
  | 'inversion'
  | 'plus2'
  | 'joker'
  | 'plus4'

export interface CarteUno {
  /** `null` pour les jokers et les +4, qui n'ont pas de couleur propre. */
  couleur: Couleur | null
  valeur: Valeur
}

export const COULEURS: readonly Couleur[] = ['rouge', 'jaune', 'vert', 'bleu']

export const CHIFFRES: readonly Valeur[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

export const LIBELLES: Record<Valeur, string> = {
  '0': '0',
  '1': '1',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  passe: '⃠',
  inversion: '⇄',
  plus2: '+2',
  joker: '★',
  plus4: '+4',
}

export const NOMS_COULEURS: Record<Couleur, string> = {
  rouge: 'Rouge',
  jaune: 'Jaune',
  vert: 'Vert',
  bleu: 'Bleu',
}

/** Une carte qui fait piocher : c'est sur elles que reposent les cumuls. */
export function estPioche(carte: CarteUno): boolean {
  return carte.valeur === 'plus2' || carte.valeur === 'plus4'
}

/** Une carte sans couleur propre, dont le poseur choisit la couleur. */
export function estJoker(carte: CarteUno): boolean {
  return carte.valeur === 'joker' || carte.valeur === 'plus4'
}

/**
 * Jeu de 108 cartes : par couleur un 0, deux exemplaires de 1 à 9, et deux
 * exemplaires de chaque effet ; plus quatre jokers et quatre +4.
 */
export function construireJeu(): CarteUno[] {
  const cartes: CarteUno[] = []

  for (const couleur of COULEURS) {
    cartes.push({ couleur, valeur: '0' })
    for (const chiffre of CHIFFRES.slice(1)) {
      cartes.push({ couleur, valeur: chiffre })
      cartes.push({ couleur, valeur: chiffre })
    }
    for (const effet of ['passe', 'inversion', 'plus2'] as const) {
      cartes.push({ couleur, valeur: effet })
      cartes.push({ couleur, valeur: effet })
    }
  }

  for (let i = 0; i < 4; i++) {
    cartes.push({ couleur: null, valeur: 'joker' })
    cartes.push({ couleur: null, valeur: 'plus4' })
  }

  return cartes
}

export function memeCarte(a: CarteUno, b: CarteUno): boolean {
  return a.couleur === b.couleur && a.valeur === b.valeur
}
