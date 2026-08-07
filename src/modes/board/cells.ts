/** Composition figée de l'anneau : 24 cases, disposition volontairement irrégulière. */

export type CellKind = 'neutre' | 'gage' | 'tournee' | 'duel' | 'teleport'

export const BOARD_SIZE = 24

export const CELLS: readonly CellKind[] = [
  'neutre', // 0 — départ
  'neutre', // 1
  'gage', // 2
  'neutre', // 3
  'duel', // 4
  'neutre', // 5
  'tournee', // 6
  'neutre', // 7
  'neutre', // 8
  'gage', // 9
  'teleport', // 10
  'neutre', // 11
  'neutre', // 12
  'duel', // 13
  'neutre', // 14
  'tournee', // 15
  'neutre', // 16
  'gage', // 17
  'neutre', // 18
  'neutre', // 19
  'duel', // 20
  'teleport', // 21
  'tournee', // 22
  'gage', // 23
]

export const CELL_LABELS: Record<CellKind, string> = {
  neutre: 'Rien à signaler',
  gage: 'Gage',
  tournee: 'Tournée',
  duel: 'Duel',
  teleport: 'Téléportation',
}

/** Gorgées distribuées par celui qui tombe sur une Tournée. */
export const TOURNEE_SIPS = 3
/** Gorgées encaissées par qui refuse son gage. */
export const GAGE_REFUSAL_SIPS = 3
/** Cases gagnées par le 1ᵉʳ, le 2ᵉ et le 3ᵉ du mini-jeu. */
export const GAINS: readonly number[] = [3, 2, 1]
/** Cases gagnées par un parieur qui a vu juste. */
export const BET_REWARD_STEPS = 1
/** Gorgées pour un parieur qui s'est trompé. */
export const BET_PENALTY_SIPS = 1

export const GAGES: readonly string[] = [
  'Parle avec un accent de ton choix jusqu’à la fin de la manche.',
  'Raconte ta pire soirée en trente secondes.',
  'Laisse ton voisin de gauche écrire ton prochain message à qui il veut.',
  'Chante le refrain de la dernière chanson que tu as écoutée.',
  'Reste debout jusqu’à la fin de la manche.',
  'Tu n’as plus le droit de dire « non » jusqu’à la prochaine manche.',
  'Imite quelqu’un de la table, les autres doivent deviner qui.',
  'Fais une déclaration d’amour à un objet de la pièce.',
  'Change de place avec la personne en face de toi.',
  'Tu parles à la troisième personne jusqu’à la fin de la manche.',
  'Donne ton téléphone à ton voisin de droite pendant une manche.',
  'Fais dix pompes, ou passe et bois.',
  'Raconte une anecdote gênante sur toi.',
  'Appelle la première personne de tes favoris et dis-lui bonjour.',
  'Tu dois finir chaque phrase par « et c’est comme ça » jusqu’à la prochaine manche.',
  'Choisis quelqu’un : vous êtes liés, il boit quand tu bois jusqu’à la fin de la manche.',
]
