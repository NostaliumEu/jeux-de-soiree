/**
 * Génère le dictionnaire de Bombe Party.
 *
 *   npm install --no-save an-array-of-french-words
 *   node scripts/generer-dictionnaire.mjs
 *
 * Le paquet npm n'est PAS une dépendance du projet : il ne sert qu'à produire
 * les deux fichiers de contenu, qui sont versionnés. Une machine de jeu doit
 * rester sans dépendance, et le serveur n'a pas à embarquer 4 Mo de listes
 * pour n'en garder qu'une fraction.
 */

import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const brut = require('an-array-of-french-words')

/** Retire les accents : on ne va pas exiger d'un joueur pressé qu'il tape « à ». */
const sansAccent = (mot) => mot.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

const mots = new Set()
for (const brutMot of brut) {
  const mot = sansAccent(brutMot.toLowerCase())
  // On écarte les sigles, les mots à trait d'union et les curiosités : ils
  // rendent le jeu confus plus qu'ils ne l'enrichissent.
  if (!/^[a-z]{3,12}$/.test(mot)) continue
  mots.add(mot)
}

const liste = [...mots].sort()

// Syllabes jouables : celles qui laissent un vrai choix. Trop rares, elles
// bloquent la table ; trop courantes, elles rendent le jeu trivial.
const compte = new Map()
for (const mot of liste) {
  const vues = new Set()
  for (const taille of [2, 3]) {
    for (let i = 0; i + taille <= mot.length; i++) {
      vues.add(mot.slice(i, i + taille))
    }
  }
  for (const s of vues) compte.set(s, (compte.get(s) ?? 0) + 1)
}

const MIN = 60
const MAX = 8_000
const syllabes = [...compte.entries()]
  .filter(([s, n]) => n >= MIN && n <= MAX && /^[a-z]+$/.test(s))
  .sort((a, b) => b[1] - a[1])
  .map(([s]) => s)

writeFileSync(
  'src/games/bombe/content/mots.fr.json',
  JSON.stringify({ mots: liste.join(' ') }),
)
writeFileSync(
  'src/games/bombe/content/syllabes.fr.json',
  JSON.stringify({ syllabes }, null, 0),
)

const ko = (n) => Math.round(n / 1024) + ' Ko'
console.log('mots retenus    :', liste.length)
console.log('syllabes        :', syllabes.length)
console.log('taille mots     :', ko(liste.join(' ').length))
console.log('taille syllabes :', ko(syllabes.join(' ').length))
console.log('echantillon     :', syllabes.slice(0, 12).join(', '))
console.log('les plus rares  :', syllabes.slice(-8).join(', '))
