import { describe, it, expect } from 'vitest'
import { createRng } from './rng'
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  eligibleGames,
  generateCode,
  isValidCode,
  pickGame,
  pickParticipants,
} from './session'
import { GAMES, getGame, findGame } from './registry'
import type { PlayerId } from './types'

const JOUEURS: PlayerId[] = ['a', 'b', 'c', 'd', 'e', 'f']

function participation(entries: Partial<Record<PlayerId, number>> = {}): Record<PlayerId, number> {
  const out: Record<PlayerId, number> = {}
  for (const id of JOUEURS) out[id] = entries[id] ?? 0
  return out
}

describe('generateCode', () => {
  it('produit un code de la bonne longueur', () => {
    expect(generateCode(createRng('code'))).toHaveLength(CODE_LENGTH)
  })

  it('n’utilise que l’alphabet sans ambiguïté', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode(createRng(`code-${i}`))
      for (const caractere of code) expect(CODE_ALPHABET).toContain(caractere)
    }
  })

  it('n’émet jamais de caractère confondable', () => {
    for (const interdit of ['I', 'O', '0', '1']) {
      expect(CODE_ALPHABET).not.toContain(interdit)
    }
  })

  it('valide ses propres codes', () => {
    expect(isValidCode(generateCode(createRng('valide')))).toBe(true)
    expect(isValidCode('AB')).toBe(false)
    expect(isValidCode('ABC0')).toBe(false)
  })
})

describe('registre', () => {
  it('inscrit les quatre jeux de la V1', () => {
    expect(GAMES.map((g) => g.definition.key).sort()).toEqual([
      'faux-depart',
      'gardien',
      'purple',
      'tu-preferes',
    ])
  })

  it('retrouve un jeu par sa clé', () => {
    expect(getGame('purple').definition.name).toBe('Purple')
    expect(findGame('inexistant')).toBeUndefined()
    expect(() => getGame('inexistant')).toThrow()
  })
})

describe('eligibleGames', () => {
  it('exclut les jeux qui exigent plus de joueurs que présents', () => {
    const cles = eligibleGames(2, false).map((g) => g.definition.key)
    expect(cles).toContain('purple')
    expect(cles).toContain('faux-depart')
    expect(cles).not.toContain('gardien')
    expect(cles).not.toContain('tu-preferes')
  })

  it('n’exclut rien à six joueurs', () => {
    expect(eligibleGames(6, false)).toHaveLength(4)
  })
})

describe('pickGame', () => {
  it('ne retire jamais le même jeu deux fois de suite', () => {
    for (let i = 0; i < 100; i++) {
      const choisi = pickGame(6, 'purple', createRng(`pick-${i}`), true)
      expect(choisi.definition.key).not.toBe('purple')
    }
  })

  it('retombe sur l’unique jeu éligible même s’il vient d’être joué', () => {
    // À deux joueurs, seuls Purple et Le Faux Départ tiennent ; avec un seul
    // éligible on ne peut plus éviter la répétition.
    const choisi = pickGame(2, 'purple', createRng('repli'), true)
    expect(choisi.definition.key).toBe('faux-depart')
  })

  it('jette s’il n’existe aucun jeu jouable', () => {
    expect(() => pickGame(1, null, createRng('vide'))).toThrow()
  })
})

describe('pickParticipants', () => {
  it('sélectionne exactement deux joueurs pour un duel', () => {
    const choisis = pickParticipants(
      JOUEURS,
      'duel',
      getGame('faux-depart').definition,
      participation(),
      createRng('duel'),
    )
    expect(choisis).toHaveLength(2)
    expect(new Set(choisis).size).toBe(2)
  })

  it('privilégie ceux qui ont le moins participé', () => {
    const choisis = pickParticipants(
      JOUEURS,
      'duel',
      getGame('faux-depart').definition,
      participation({ a: 5, b: 5, c: 5, d: 5, e: 0, f: 0 }),
      createRng('equite'),
    )
    expect(new Set(choisis)).toEqual(new Set(['e', 'f']))
  })

  it('respecte le plafond d’un jeu asymétrique', () => {
    const choisis = pickParticipants(
      JOUEURS,
      'asymetrique',
      getGame('gardien').definition,
      participation(),
      createRng('asym'),
    )
    // Le Gardien plafonne à 6 : un gardien et cinq tireurs.
    expect(choisis).toHaveLength(6)
  })

  it('emmène tout le monde sur un jeu « tous »', () => {
    const choisis = pickParticipants(
      JOUEURS,
      'tous',
      getGame('tu-preferes').definition,
      participation(),
      createRng('tous'),
    )
    expect(new Set(choisis)).toEqual(new Set(JOUEURS))
  })

  it('refuse un duel à un seul joueur', () => {
    expect(() =>
      pickParticipants(
        ['a'],
        'duel',
        getGame('faux-depart').definition,
        participation(),
        createRng('solo'),
      ),
    ).toThrow()
  })
})
