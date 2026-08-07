/**
 * Aléa déterministe à graine.
 *
 * Aucune machine de jeu n'appelle `Math.random`. L'aléa arrive toujours par
 * `ctx.rng`, alimenté par une graine stockée en base au démarrage de la manche.
 * Combiné au journal `actions`, cela rend toute partie rejouable à l'identique :
 * un bug de règles signalé par un joueur se reproduit en local sans deviner.
 */

export interface Rng {
  /** Flottant dans [0, 1). */
  next(): number
  /** Entier dans [min, max], bornes incluses. */
  intRange(min: number, max: number): number
  /** Un élément au hasard. Jette si la liste est vide. */
  pick<T>(items: readonly T[]): T
}

/** Hachage d'une chaîne vers quatre entiers 32 bits (cyrb128). */
function hashSeed(seed: string): number {
  let h1 = 1779033703
  let h2 = 3144134277
  let h3 = 1013904242
  let h4 = 2773480762

  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }

  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)

  return (h1 ^ h2 ^ h3 ^ h4) >>> 0
}

export function createRng(seed: string): Rng {
  let state = hashSeed(seed)

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const intRange = (min: number, max: number): number => {
    if (max < min) throw new Error(`intRange: bornes inversées (${min} > ${max})`)
    return min + Math.floor(next() * (max - min + 1))
  }

  const pick = <T,>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error('pick: liste vide')
    return items[intRange(0, items.length - 1)] as T
  }

  return { next, intRange, pick }
}

/** Fisher-Yates. Ne mute jamais la source. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.intRange(0, i)
    const atI = out[i] as T
    const atJ = out[j] as T
    out[i] = atJ
    out[j] = atI
  }
  return out
}
