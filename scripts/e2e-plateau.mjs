/**
 * Simulation d'une partie de plateau complète, contre une vraie base.
 *
 * Quatre joueurs automatiques enchaînent les manches jusqu'au bout, quel que
 * soit le mini-jeu tiré, en pariant, en résolvant les cases Tournée et Duel, et
 * en vérifiant à chaque tour la cohérence de la comptabilité : étoiles, cases
 * parcourues, gorgées consolidées.
 *
 *   npm run test:plateau
 *   E2E_BASE=https://jeux-de-soiree.vercel.app npm run test:plateau
 */

import { readFileSync } from 'node:fs'

for (const ligne of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = ligne.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000'
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const MANCHES = 6

let ok = 0
let ko = 0

function verifier(nom, condition, detail = '') {
  if (condition) {
    ok++
    console.log(`  OK    ${nom}${detail ? ' — ' + detail : ''}`)
  } else {
    ko++
    console.log(`  ECHEC ${nom}${detail ? ' — ' + detail : ''}`)
  }
}

async function post(chemin, corps) {
  const r = await fetch(BASE + chemin, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corps),
  })
  return { statut: r.status, ...(await r.json().catch(() => ({}))) }
}

async function lire(table, filtre) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${filtre}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  })
  return r.ok ? await r.json() : []
}

console.log('\n=== Mise en place ===')

const noms = ['Kévin', 'Léa', 'Marc', 'Nina']
const emojis = ['🦊', '🐼', '🐸', '🦉']

const hote = await post('/api/session', {
  action: 'create',
  nickname: noms[0],
  avatar: emojis[0],
  mode: 'board',
  totalRounds: MANCHES,
})
verifier('création d’une soirée en mode Plateau', hote.statut === 200, hote.error ?? `code ${hote.code}`)
if (hote.statut !== 200) process.exit(1)

const joueurs = [hote]
for (let i = 1; i < noms.length; i++) {
  joueurs.push(await post('/api/session', { action: 'join', code: hote.code, nickname: noms[i], avatar: emojis[i] }))
}
verifier('quatre joueurs présents', joueurs.every((j) => j.statut === 200))

const parId = Object.fromEntries(joueurs.map((j) => [j.playerId, j]))
const nomDe = Object.fromEntries(joueurs.map((j, i) => [j.playerId, noms[i]]))

const avant = await lire('board_state', `session_id=eq.${hote.sessionId}&select=state`)
verifier('aucun plateau avant le lancement', avant.length === 0)

console.log('\n=== Déroulement de la partie ===')

/** Joue le coup qui s'impose pour un participant, quel que soit le mini-jeu. */
async function agir(round, etat, joueur) {
  const envoi = (payload) =>
    post('/api/play', {
      scope: 'game',
      sessionId: hote.sessionId,
      playerId: joueur.playerId,
      token: joueur.token,
      roundId: round.id,
      payload,
    })

  switch (round.game_key) {
    case 'purple':
      if (etat.order[etat.currentIndex] !== joueur.playerId) return null
      return envoi({ type: 'bet', bet: 'red' })
    case 'faux-depart':
      if (etat.taps?.[joueur.playerId]) return null
      return envoi({ type: 'tap', offsetMs: 180 + Math.floor(Math.random() * 250) })
    case 'gardien':
      if (etat.chosen?.includes(joueur.playerId)) return null
      return envoi({ type: 'choose', corner: ['HG', 'HD', 'BG', 'BD', 'C'][Math.floor(Math.random() * 5)] })
    case 'tu-preferes': {
      if (etat.voted?.includes(joueur.playerId)) return null
      const q = etat.current
      if (!q) return null
      const choix = q.type === 'binaire' ? (Math.random() < 0.5 ? 'a' : 'b') : etat.participants[0]
      return envoi({ type: 'vote', choice: choix })
    }
    default:
      return null
  }
}

let manchesJouees = 0
let plateau = null
let garde = 0

// L'hôte ouvre la partie.
const ouverture = await post('/api/session', {
  action: 'start',
  sessionId: hote.sessionId,
  playerId: hote.playerId,
  token: hote.token,
})
verifier('l’hôte lance la première manche', ouverture.statut === 200, ouverture.error ?? '')
if (ouverture.statut !== 200) process.exit(1)

plateau = (await lire('board_state', `session_id=eq.${hote.sessionId}&select=state`))[0]?.state
verifier('le plateau est posé au lancement', !!plateau)
verifier('quatre pions au départ', plateau?.players?.length === 4)
verifier('l’étoile n’est pas sur la case de départ', plateau?.starCell !== 0)

while (garde++ < 400) {
  const [session] = await lire('sessions', `id=eq.${hote.sessionId}&select=*`)
  if (!session) break

  if (session.status === 'finished') break

  if (session.status === 'results') {
    plateau = (await lire('board_state', `session_id=eq.${hote.sessionId}&select=state`))[0]?.state

    // Les cases Tournée et Duel attendent une décision humaine.
    for (const attente of plateau?.pendings ?? []) {
      const j = parId[attente.player]
      const cible = joueurs.find((x) => x.playerId !== attente.player)
      const payload =
        attente.kind === 'tournee'
          ? { kind: 'tournee', distribution: { [cible.playerId]: 3 } }
          : { kind: 'duel', opponent: cible.playerId }
      await post('/api/play', {
        scope: 'board',
        sessionId: hote.sessionId,
        playerId: j.playerId,
        token: j.token,
        payload,
      })
    }

    manchesJouees = plateau?.roundIndex ?? 0
    const classement = [...(plateau?.players ?? [])].sort(
      (a, b) => b.stars * 10000 + b.distance - (a.stars * 10000 + a.distance),
    )
    console.log(
      `  manche ${manchesJouees}/${MANCHES} — ` +
        classement.map((p) => `${nomDe[p.id]} ${p.stars}⭐ ${p.distance}c`).join(' · '),
    )

    const suite = await post('/api/session', {
      action: 'next',
      sessionId: hote.sessionId,
      playerId: hote.playerId,
      token: hote.token,
    })
    if (suite.statut !== 200) {
      verifier('enchaînement de la manche suivante', false, suite.error)
      break
    }
    continue
  }

  const [round] = await lire('rounds', `id=eq.${session.current_round_id}&select=*`)
  if (!round) break

  if (round.status === 'betting') {
    for (const j of joueurs) {
      if (round.participants.includes(j.playerId)) continue
      if (round.bets?.[j.playerId]) continue
      await post('/api/play', {
        scope: 'bet',
        sessionId: hote.sessionId,
        playerId: j.playerId,
        token: j.token,
        roundId: round.id,
        target: round.participants[0],
      })
    }
    continue
  }

  const [etatLigne] = await lire('round_public_state', `round_id=eq.${round.id}&select=public_state`)
  const etat = etatLigne?.public_state
  if (!etat || etat.phase === 'over') continue

  let aJoue = false
  for (const id of round.participants) {
    const r = await agir(round, etat, parId[id])
    if (r?.statut === 200) {
      aJoue = true
      break // l'état a changé, on le relit
    }
  }
  if (!aJoue) {
    // Personne ne pouvait jouer : on laisse expirer la phase.
    await post('/api/play', {
      scope: 'game',
      sessionId: hote.sessionId,
      playerId: hote.playerId,
      token: hote.token,
      roundId: round.id,
      payload: { type: 'timeout' },
    })
  }
}

console.log('\n=== Vérification de la comptabilité ===')

const [session] = await lire('sessions', `id=eq.${hote.sessionId}&select=*`)
plateau = (await lire('board_state', `session_id=eq.${hote.sessionId}&select=state`))[0]?.state
const compte = await lire('tally', `session_id=eq.${hote.sessionId}&select=player_id,sips_total`)

verifier('la partie est allée à son terme', session?.status === 'finished', `statut ${session?.status}`)
verifier('le nombre de manches prévu est respecté', plateau?.roundIndex === MANCHES, `${plateau?.roundIndex}/${MANCHES}`)
verifier('le plateau est marqué terminé', plateau?.finished === true)
verifier('aucun effet de case resté en attente', (plateau?.pendings ?? []).length === 0)

const pions = plateau?.players ?? []
verifier('les quatre pions sont sur l’anneau', pions.length === 4)
verifier(
  'toutes les positions sont valides',
  pions.every((p) => Number.isInteger(p.position) && p.position >= 0 && p.position < 24),
  pions.map((p) => p.position).join(', '),
)
verifier(
  'au moins un joueur a avancé',
  pions.some((p) => p.distance > 0),
  pions.map((p) => `${nomDe[p.id]} ${p.distance}c`).join(' · '),
)
verifier(
  'les étoiles sont des entiers positifs',
  pions.every((p) => Number.isInteger(p.stars) && p.stars >= 0),
  pions.map((p) => `${nomDe[p.id]} ${p.stars}⭐`).join(' · '),
)

const sipsPlateau = plateau?.sips ?? {}
const sipsTally = Object.fromEntries(compte.map((l) => [l.player_id, l.sips_total]))
const ecarts = Object.entries(sipsPlateau)
  .filter(([id, n]) => n > 0 && (sipsTally[id] ?? 0) !== n)
  .map(([id, n]) => `${nomDe[id]}: plateau ${n} vs total ${sipsTally[id] ?? 0}`)

verifier(
  'les gorgées du plateau et le total consolidé concordent',
  ecarts.length === 0,
  ecarts.length ? ecarts.join(' | ') : Object.entries(sipsPlateau).map(([id, n]) => `${nomDe[id]} ${n}`).join(' · '),
)

const total = Object.values(sipsPlateau).reduce((a, b) => a + b, 0)
verifier('des gorgées ont bien été distribuées', total > 0, `${total} au total`)

console.log(`\n${'='.repeat(46)}`)
console.log(`  ${ok} verifications OK, ${ko} en echec`)
console.log(`${'='.repeat(46)}\n`)
process.exit(ko === 0 ? 0 : 1)
