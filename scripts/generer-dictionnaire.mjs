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

// Syllabes jouables.
//
// Le nombre total de mots contenant la syllabe est un mauvais critère : « xis »
// en compte 167, mais ce sont presque tous des conjugaisons de « coexister »,
// que personne ne retrouve avec une mèche qui grésille. Ce qui compte, ce sont
// les mots COURTS — ceux qui viennent vite. On exige donc les deux.
const compte = new Map()
const compteCourt = new Map()

const recenser = (mot, table) => {
  const vues = new Set()
  for (const taille of [2, 3]) {
    for (let i = 0; i + taille <= mot.length; i++) vues.add(mot.slice(i, i + taille))
  }
  for (const s of vues) table.set(s, (table.get(s) ?? 0) + 1)
}

for (const mot of liste) {
  recenser(mot, compte)
  if (mot.length <= 8) recenser(mot, compteCourt)
}

const MIN_TOTAL = 400
const MIN_COURTS = 80
const syllabes = [...compte.entries()]
  .filter(([s, n]) => n >= MIN_TOTAL && (compteCourt.get(s) ?? 0) >= MIN_COURTS)
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
console.log(
  'mots courts pour la plus rare :',
  compteCourt.get(syllabes[syllabes.length - 1]) ?? 0,
)
