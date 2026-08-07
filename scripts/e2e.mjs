/**
 * Test de bout en bout, contre une vraie base Supabase.
 *
 * Couvre ce qu'aucun test unitaire ne peut couvrir : les route handlers, la
 * persistance, et surtout l'étanchéité RLS de l'état secret. C'est ce test qui
 * a débusqué le fait qu'une manche de Purple ne démarrait pas, parce que sa
 * vue privée est nulle et que la colonne ne l'acceptait pas.
 *
 * Prérequis : le serveur doit tourner (`npm run dev`) et `.env.local` être
 * renseigné.
 *
 *   npm run test:e2e
 *   E2E_BASE=http://localhost:3100 npm run test:e2e
 */

import { readFileSync } from 'node:fs'

for (const ligne of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = ligne.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000'
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

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

/** Lecture avec la clé publique, exactement comme le navigateur d'un joueur. */
async function lireCommeNavigateur(table, filtre) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${filtre}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  })
  return { statut: r.status, corps: await r.json().catch(() => null) }
}

const vide = (r) => r.statut !== 200 || (Array.isArray(r.corps) && r.corps.length === 0)

console.log('\n=== 1. Cycle de vie d’une soirée ===')

const hote = await post('/api/session', {
  action: 'create',
  nickname: 'Kévin',
  avatar: '🦊',
  mode: 'free',
})
verifier('création de la soirée', hote.statut === 200, `code ${hote.code}`)
if (hote.statut !== 200) {
  console.log('   réponse :', JSON.stringify(hote))
  process.exit(1)
}
verifier('code à 4 caractères', hote.code?.length === 4)
verifier('jeton joueur délivré', typeof hote.token === 'string' && hote.token.length > 20)

const lea = await post('/api/session', { action: 'join', code: hote.code, nickname: 'Léa', avatar: '🐼' })
const marc = await post('/api/session', { action: 'join', code: hote.code, nickname: 'Marc', avatar: '🐸' })
verifier('deux joueurs rejoignent par le code', lea.statut === 200 && marc.statut === 200)

const mauvaisCode = await post('/api/session', {
  action: 'join',
  code: 'ZZZZ',
  nickname: 'Intrus',
  avatar: '🐙',
})
verifier('un code inexistant est refusé', mauvaisCode.statut === 404)

console.log('\n=== 2. Lancement d’une manche de Purple ===')

const lance = await post('/api/session', {
  action: 'start',
  sessionId: hote.sessionId,
  playerId: hote.playerId,
  token: hote.token,
  gameKey: 'purple',
})
verifier('l’hôte lance Purple', lance.statut === 200 && !!lance.roundId, lance.error ?? '')
const roundId = lance.roundId

const usurpation = await post('/api/session', {
  action: 'start',
  sessionId: hote.sessionId,
  playerId: lea.playerId,
  token: lea.token,
  gameKey: 'purple',
})
verifier('un non-hôte ne peut pas lancer de manche', usurpation.statut === 403)

const faux = await post('/api/session', {
  action: 'start',
  sessionId: hote.sessionId,
  playerId: hote.playerId,
  token: 'jeton-bidon-mais-assez-long',
  gameKey: 'purple',
})
verifier('un jeton invalide est rejeté', faux.statut === 403)

console.log('\n=== 3. Étanchéité de l’état secret (le test qui compte) ===')

const pub = await lireCommeNavigateur('round_public_state', `round_id=eq.${roundId}&select=*`)
verifier('le navigateur lit l’état public', pub.statut === 200 && pub.corps?.length === 1)

verifier(
  'le paquet de cartes est INACCESSIBLE au navigateur',
  vide(await lireCommeNavigateur('round_secret_state', `round_id=eq.${roundId}&select=*`)),
)
verifier('les jetons joueurs sont INACCESSIBLES', vide(await lireCommeNavigateur('player_secrets', 'select=*')))
verifier('le journal d’actions est INACCESSIBLE', vide(await lireCommeNavigateur('actions', 'select=*')))

const ecriture = await fetch(`${SB_URL}/rest/v1/sessions`, {
  method: 'POST',
  headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json' },
  body: JSON.stringify({ code: 'HACK' }),
})
verifier('le navigateur ne peut RIEN écrire', ecriture.status >= 400, `statut ${ecriture.status}`)

const menage = await fetch(`${SB_URL}/rest/v1/rpc/cleanup_stale_sessions`, {
  method: 'POST',
  headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json' },
  body: '{}',
})
verifier('la fonction de ménage n’est plus appelable publiquement', menage.status >= 400, `statut ${menage.status}`)

console.log('\n=== 4. Une manche de Purple se joue vraiment ===')

const etat0 = pub.corps[0].public_state
verifier('la banque démarre à zéro', etat0.bank === 0)
verifier('aucune carte de référence au premier tour', etat0.reference === null)
verifier('trois joueurs dans l’ordre de passage', etat0.order.length === 3)

const identites = { [hote.playerId]: hote, [lea.playerId]: lea, [marc.playerId]: marc }
const noms = { [hote.playerId]: 'Kévin', [lea.playerId]: 'Léa', [marc.playerId]: 'Marc' }
const premier = etat0.order[etat0.currentIndex]
const moi = identites[premier]
const horsTour = Object.values(identites).find((i) => i.playerId !== premier)

const refus = await post('/api/play', {
  scope: 'game',
  sessionId: hote.sessionId,
  playerId: horsTour.playerId,
  token: horsTour.token,
  roundId,
  payload: { type: 'bet', bet: 'red' },
})
verifier('un joueur hors tour est refusé', refus.statut === 400, refus.error)

const trop = await post('/api/play', {
  scope: 'game',
  sessionId: hote.sessionId,
  playerId: moi.playerId,
  token: moi.token,
  roundId,
  payload: { type: 'bet', bet: 'higher' },
})
verifier('« plus haut » est refusé sans carte de référence', trop.statut === 400, trop.error)

const coup = await post('/api/play', {
  scope: 'game',
  sessionId: hote.sessionId,
  playerId: moi.playerId,
  token: moi.token,
  roundId,
  payload: { type: 'bet', bet: 'red' },
})
verifier(`${noms[premier]} parie « rouge »`, coup.statut === 200, coup.error ?? '')

const pub2 = await lireCommeNavigateur('round_public_state', `round_id=eq.${roundId}&select=*`)
const etat1 = pub2.corps[0].public_state
const reussi = etat1.bank === 1

verifier(
  'une carte a été tirée',
  etat1.reference !== null,
  etat1.reference ? etat1.reference.rank + etat1.reference.suit : '',
)
verifier('la main est passée au joueur suivant', etat1.currentIndex === 1)
verifier(
  reussi ? 'réussite : +1 dans la banque' : 'échec : le fautif a bu la banque',
  reussi ? etat1.bank === 1 : etat1.bank === 0 && etat1.failures === 1,
  `banque ${etat1.bank}, échecs ${etat1.failures}`,
)
verifier('l’historique enregistre le coup', etat1.history?.length === 1)

console.log('\n=== 5. Quitter, et fermeture par l’hôte ===')

const parti = await post('/api/session', {
  action: 'leave',
  sessionId: hote.sessionId,
  playerId: marc.playerId,
  token: marc.token,
})
verifier('un joueur ordinaire peut quitter', parti.statut === 200)
verifier('son départ ne ferme PAS la soirée', parti.ferme === false)

const ferme = await post('/api/session', {
  action: 'leave',
  sessionId: hote.sessionId,
  playerId: hote.playerId,
  token: hote.token,
})
verifier('l’hôte peut quitter', ferme.statut === 200)
verifier('son départ ferme la soirée', ferme.ferme === true)

const etatSession = await lireCommeNavigateur('sessions', `id=eq.${hote.sessionId}&select=status`)
const apres = etatSession.corps?.[0]
verifier('la soirée est marquée close', apres?.status === 'closed', apres?.status)

const relance = await post('/api/session', {
  action: 'start',
  sessionId: hote.sessionId,
  playerId: lea.playerId,
  token: lea.token,
  gameKey: 'purple',
})
verifier('plus aucune manche ne peut être lancée', relance.statut === 400, relance.error)

const retardataire = await post('/api/session', {
  action: 'join',
  code: hote.code,
  nickname: 'Retard',
  avatar: '🦉',
})
verifier('plus personne ne peut rejoindre', retardataire.statut === 400, retardataire.error)

const sortie = await post('/api/session', {
  action: 'leave',
  sessionId: hote.sessionId,
  playerId: lea.playerId,
  token: lea.token,
})
verifier('quitter reste toujours possible', sortie.statut === 200)

console.log(`\n${'='.repeat(46)}`)
console.log(`  ${ok} verifications OK, ${ko} en echec`)
console.log(`${'='.repeat(46)}\n`)
process.exit(ko === 0 ? 0 : 1)
