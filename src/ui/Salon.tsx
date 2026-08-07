'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from '@/client/useSession'
import { useHorloge } from '@/client/useHorloge'
import { api, ecrireIdentite, lireIdentite, oublierIdentite } from '@/client/api'
import { avatarDe, nomDe, type Identite, type Instantane } from '@/client/types'
import { AVATARS } from '@/shared/avatars'
import { CATALOGUE, ficheDe } from '@/shared/jeux'
import { TOURNEE_SIPS } from '@/modes/board/cells'
import { BoardView } from '@/modes/board/BoardView'
import { ECRANS } from './ecrans'
import { Bloc, Bouton, BoutonFantome, Cascade, Pastille, Surtitre } from './primitives'

export function Salon({ code }: { code: string }) {
  const { instantane, erreur, chargement, appliquerEtat } = useSession(code)
  const decalage = useHorloge()
  const [identite, setIdentite] = useState<Identite | null>(null)
  const [identitePrete, setIdentitePrete] = useState(false)
  const [vuePrivee, setVuePrivee] = useState<unknown>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setIdentite(lireIdentite(code))
    setIdentitePrete(true)
  }, [code])

  const signaler = useCallback(
    (e: unknown) => {
      const texte = e instanceof Error ? e.message : 'Action impossible.'
      if (texte.includes('Identité invalide')) {
        oublierIdentite(code)
        setIdentite(null)
      }
      setMessage(texte)
      setTimeout(() => setMessage(null), 4_000)
    },
    [code],
  )

  const mancheId = instantane?.manche?.id ?? null

  // La vue personnelle (mon choix, mon vote) ne transite pas par le temps réel :
  // elle est servie par l'API contre présentation du jeton. On ne la redemande
  // qu'au changement de manche ou d'état — la relire à chaque rafraîchissement
  // ajoutait un aller-retour pour rien.
  const version = instantane?.version ?? 0
  useEffect(() => {
    if (!identite || !mancheId) {
      setVuePrivee(null)
      return
    }
    let annule = false
    void api.vuePrivee(identite, mancheId).then((vue) => {
      if (!annule) setVuePrivee(vue)
    })
    return () => {
      annule = true
    }
  }, [identite, mancheId, version])

  const echeance = (instantane?.etatPublic?.['deadlineAt'] as number | null) ?? null

  // Personne ne surveille les phases côté serveur : c'est le premier client
  // réveillé qui réclame l'expiration, et le serveur revérifie la date. Le
  // délai aléatoire évite que dix téléphones tirent en même temps.
  useEffect(() => {
    if (echeance === null || !identite || !mancheId) return
    if (instantane?.manche?.status !== 'playing') return

    const attente = Math.max(0, echeance - (Date.now() + decalage)) + 400 + Math.random() * 900
    const timer = setTimeout(() => {
      void api.jouer(identite, mancheId, { type: 'timeout' }).catch(() => {})
    }, attente)

    return () => clearTimeout(timer)
  }, [echeance, identite, mancheId, decalage, instantane?.manche?.status])

  const envoyer = useCallback(
    async (payload: unknown) => {
      if (!identite || !mancheId) return
      try {
        const reponse = await api.jouer(identite, mancheId, payload)
        // Le serveur renvoie le nouvel état : on l'affiche tout de suite plutôt
        // que d'attendre qu'il nous revienne par le temps réel.
        if (reponse.etat) appliquerEtat(reponse.etat)
      } catch (e) {
        signaler(e)
      }
    },
    [identite, mancheId, signaler, appliquerEtat],
  )

  const commande = useCallback(
    async (action: 'start' | 'next' | 'lobby' | 'close-bets', gameKey?: string) => {
      if (!identite) return
      try {
        await api.hote(identite, action, gameKey)
      } catch (e) {
        signaler(e)
      }
    },
    [identite, signaler],
  )

  if (chargement || !identitePrete) {
    return <Attente texte="Connexion à la soirée…" />
  }

  if (erreur) {
    return <Panne texte={erreur} />
  }

  if (!instantane) {
    return <Panne texte="Soirée introuvable." />
  }

  if (!identite) {
    return (
      <Arrivee
        code={code}
        joueurs={instantane.joueurs.length}
        surErreur={signaler}
        surEntree={(nouvelle) => {
          ecrireIdentite(nouvelle)
          setIdentite(nouvelle)
        }}
      />
    )
  }

  return (
    <main className="zone-sure mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pt-6">
      <Entete instantane={instantane} moi={identite.playerId} />

      {message && (
        <p className="rounded-xl border-2 border-rose bg-rose/10 px-4 py-2.5 text-sm text-rose">
          {message}
        </p>
      )}

      <Corps
        instantane={instantane}
        identite={identite}
        decalage={decalage}
        vuePrivee={vuePrivee}
        envoyer={envoyer}
        commande={commande}
      />

      <Quitter
        identite={identite}
        hote={instantane.session.host_player_id === identite.playerId}
        close={instantane.session.status === 'closed' || instantane.session.status === 'expired'}
        surErreur={signaler}
      />
    </main>
  )
}

/**
 * Sortie de soirée.
 *
 * Pour l'hôte, partir ferme la partie pour toute la table : la confirmation
 * n'est pas une politesse, c'est un garde-fou. Le départ est aussi tenté quand
 * l'onglet se ferme, via `sendBeacon`.
 */
function Quitter({
  identite,
  hote,
  close,
  surErreur,
}: {
  identite: Identite
  hote: boolean
  close: boolean
  surErreur: (e: unknown) => void
}) {
  const [confirme, setConfirme] = useState(false)
  const [enCours, setEnCours] = useState(false)

  // Fermeture de l'onglet par l'hôte. `persisted` distingue une vraie
  // disparition d'une simple mise en arrière-plan : sur téléphone, verrouiller
  // son écran ne doit surtout pas fermer la soirée de tout le monde.
  useEffect(() => {
    if (!hote || close) return

    const surFermeture = (e: PageTransitionEvent) => {
      if (e.persisted) return
      api.quitterEnFermant(identite)
    }

    window.addEventListener('pagehide', surFermeture)
    return () => window.removeEventListener('pagehide', surFermeture)
  }, [hote, close, identite])

  const partir = async () => {
    setEnCours(true)
    try {
      await api.quitter(identite)
    } catch (e) {
      surErreur(e)
    } finally {
      oublierIdentite(identite.code)
      window.location.href = '/'
    }
  }

  if (close) return null

  return (
    <div className="mt-auto pt-8">
      {!confirme ? (
        <button
          type="button"
          onClick={() => setConfirme(true)}
          className="w-full py-3 text-center text-xs font-semibold uppercase tracking-[0.2em] text-brume/60 transition-colors hover:text-rose"
        >
          Quitter la soirée
        </button>
      ) : (
        <Bloc className="border-rose/60">
          <p className="mb-3 text-center text-sm">
            {hote ? (
              <>
                Tu es l’hôte : partir <strong className="text-rose">ferme la soirée</strong> pour
                les {''}
                autres.
              </>
            ) : (
              'Tu quittes la soirée. Tu pourras revenir avec le code.'
            )}
          </p>
          <div className="flex gap-2">
            <BoutonFantome className="flex-1" onClick={() => setConfirme(false)}>
              Annuler
            </BoutonFantome>
            <BoutonFantome
              className="flex-1 border-rose text-rose"
              disabled={enCours}
              onClick={() => void partir()}
            >
              {enCours ? '…' : hote ? 'Fermer' : 'Quitter'}
            </BoutonFantome>
          </div>
        </Bloc>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ écrans */

function Attente({ texte }: { texte: string }) {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <p className="titre animate-pulse text-center text-xl text-brume">{texte}</p>
    </main>
  )
}

function Panne({ texte }: { texte: string }) {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <Bloc className="max-w-sm text-center">
        <p className="titre mb-2 text-2xl text-rose">Aïe</p>
        <p className="text-sm text-brume">{texte}</p>
        <Link href="/" className="mt-4 inline-block text-sm font-semibold text-acide underline">
          Retour à l’accueil
        </Link>
      </Bloc>
    </main>
  )
}

function Arrivee({
  code,
  joueurs,
  surEntree,
  surErreur,
}: {
  code: string
  joueurs: number
  surEntree: (identite: Identite) => void
  surErreur: (e: unknown) => void
}) {
  const [pseudo, setPseudo] = useState('')
  const [avatar, setAvatar] = useState<string>(AVATARS[0])
  const [enCours, setEnCours] = useState(false)

  const entrer = async () => {
    setEnCours(true)
    try {
      const arrivee = await api.rejoindre(code, pseudo.trim(), avatar)
      surEntree({
        code: arrivee.code,
        sessionId: arrivee.sessionId,
        playerId: arrivee.playerId,
        token: arrivee.token,
      })
    } catch (e) {
      surErreur(e)
      setEnCours(false)
    }
  }

  return (
    <main className="zone-sure mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-5 px-5">
      <div>
        <Surtitre>Soirée {code.toUpperCase()}</Surtitre>
        <h1 className="titre text-4xl">
          {joueurs} personne{joueurs > 1 ? 's' : ''} t’attend{joueurs > 1 ? 'ent' : ''}
        </h1>
      </div>

      <Bloc className="flex flex-col gap-4">
        <div>
          <Surtitre>Ton pseudo</Surtitre>
          <input
            value={pseudo}
            onChange={(e) => setPseudo(e.target.value)}
            maxLength={20}
            placeholder="Kévin"
            className="w-full rounded-xl border-2 border-nuit-500 bg-nuit-900 px-4 py-3 text-lg outline-none focus:border-neon"
          />
        </div>
        <div>
          <Surtitre>Ton avatar</Surtitre>
          <div className="grid grid-cols-6 gap-2">
            {AVATARS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setAvatar(emoji)}
                aria-label={`Avatar ${emoji}`}
                className={[
                  'grid aspect-square place-items-center rounded-lg border-2 text-xl',
                  avatar === emoji
                    ? 'scale-110 border-acide bg-acide/15'
                    : 'border-transparent bg-nuit-700',
                ].join(' ')}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      </Bloc>

      <Bouton
        teinte="acide"
        disabled={pseudo.trim().length === 0 || enCours}
        onClick={() => void entrer()}
      >
        {enCours ? 'Un instant…' : 'Entrer'}
      </Bouton>
    </main>
  )
}

function Entete({ instantane, moi }: { instantane: Instantane; moi: string }) {
  const hote = instantane.session.host_player_id === moi

  // Le total consolidé n'est écrit en base qu'à la fin d'une manche : on lui
  // ajoute les gorgées de la manche en cours, sinon le compteur reste figé
  // pendant qu'on boit. Une fois la manche close, le total les contient déjà.
  const enCours =
    instantane.session.status === 'playing'
      ? ((instantane.etatPublic?.['sips'] as Record<string, number> | undefined)?.[moi] ?? 0)
      : 0

  const gorgees = (instantane.gorgees[moi] ?? 0) + enCours

  return (
    <header className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-brume">
          Soirée · {instantane.session.mode === 'board' ? 'Plateau' : 'Libre'}
        </p>
        <p className="chiffre text-2xl font-bold text-acide">{instantane.session.code}</p>
      </div>
      <div className="flex items-center gap-2 text-right">
        {hote && (
          <span className="rounded-full border border-or/60 px-2 py-0.5 text-[10px] font-bold uppercase text-or">
            Hôte
          </span>
        )}
        <div>
          <p className="text-[11px] uppercase tracking-widest text-brume">Bu</p>
          <p className="chiffre text-lg">{gorgees}</p>
        </div>
      </div>
    </header>
  )
}

function Corps({
  instantane,
  identite,
  decalage,
  vuePrivee,
  envoyer,
  commande,
}: {
  instantane: Instantane
  identite: Identite
  decalage: number
  vuePrivee: unknown
  envoyer: (payload: unknown) => Promise<void>
  commande: (action: 'start' | 'next' | 'lobby' | 'close-bets', gameKey?: string) => Promise<void>
}) {
  const moi = identite.playerId
  const { session, joueurs, manche, etatPublic, plateau } = instantane
  const hote = session.host_player_id === moi

  if (session.status === 'expired' || session.status === 'closed') {
    const parLHote = session.status === 'closed'
    return (
      <Cascade index={0}>
        <Bloc className="text-center">
          <p className="titre mb-2 text-3xl">Soirée terminée</p>
          <p className="text-sm text-brume">
            {parLHote
              ? 'L’hôte a fermé la soirée. L’ardoise est effacée.'
              : 'Plus rien ne s’est passé ici depuis un bon moment, alors elle s’est fermée toute seule. Les gorgées sont effacées, l’ardoise est propre.'}
          </p>
          <Link
            href="/"
            className="mt-5 inline-block rounded-2xl border-2 border-acide px-5 py-3 text-sm font-bold uppercase tracking-wide text-acide"
          >
            En ouvrir une nouvelle
          </Link>
        </Bloc>
      </Cascade>
    )
  }

  const enAttente = plateau?.pendings.find((p) => p.player === moi)
  if (enAttente) {
    return (
      <EffetEnAttente
        pending={enAttente}
        instantane={instantane}
        identite={identite}
        moi={moi}
      />
    )
  }

  if (session.status === 'finished' && plateau) {
    return (
      <Cascade index={0}>
        <div className="flex flex-col gap-4">
          <Bloc vif className="text-center">
            <Surtitre>Terminé</Surtitre>
            <p className="titre text-3xl">
              {nomDe(joueurs, plateau.players[0]?.id ?? '')} … enfin, voyons le classement
            </p>
          </Bloc>
          <BoardView plateau={plateau} joueurs={joueurs} moi={moi} />
        </div>
      </Cascade>
    )
  }

  if (session.status === 'lobby' || !manche) {
    return (
      <Lobby
        instantane={instantane}
        moi={moi}
        hote={hote}
        commande={commande}
      />
    )
  }

  if (session.status === 'results') {
    return (
      <Resultats
        instantane={instantane}
        moi={moi}
        hote={hote}
        commande={commande}
      />
    )
  }

  // Manche en cours.
  const participe = manche.participants.includes(moi)

  if (manche.status === 'betting' && !participe) {
    return <Paris instantane={instantane} identite={identite} moi={moi} />
  }

  if (manche.status === 'betting') {
    return (
      <Bloc className="text-center">
        <Surtitre>Prépare-toi</Surtitre>
        <p className="text-sm text-brume">
          Les spectateurs parient sur le vainqueur. Ça commence dans un instant.
        </p>
        {hote && (
          <BoutonFantome className="mt-4" onClick={() => void commande('close-bets')}>
            Ne plus attendre
          </BoutonFantome>
        )}
      </Bloc>
    )
  }

  const Ecran = ECRANS[manche.game_key]
  if (!Ecran || !etatPublic) {
    return <Bloc className="text-center text-sm text-brume">Chargement de la manche…</Bloc>
  }

  return (
    <div className="flex flex-col gap-4">
      <Ecran
        etat={etatPublic as never}
        moi={moi}
        joueurs={joueurs}
        participe={participe}
        decalage={decalage}
        vuePrivee={vuePrivee}
        envoyer={envoyer}
      />
      {hote && session.mode === 'free' && manche.game_key === 'purple' && (
        <BoutonFantome onClick={() => void envoyer({ type: 'finish' })}>
          Arrêter la manche
        </BoutonFantome>
      )}
    </div>
  )
}

function Lobby({
  instantane,
  moi,
  hote,
  commande,
}: {
  instantane: Instantane
  moi: string
  hote: boolean
  commande: (action: 'start' | 'next' | 'lobby' | 'close-bets', gameKey?: string) => Promise<void>
}) {
  const { session, joueurs, plateau } = instantane
  const [copie, setCopie] = useState(false)

  const partager = async () => {
    const lien = `${window.location.origin}/j/${session.code}`
    if (navigator.share) {
      await navigator.share({ title: 'Jeux de soirée', text: 'Rejoins la soirée', url: lien })
      return
    }
    await navigator.clipboard.writeText(lien)
    setCopie(true)
    setTimeout(() => setCopie(false), 2_000)
  }

  return (
    <div className="flex flex-col gap-4">
      <Cascade index={0}>
        <Bloc vif className="text-center">
          <Surtitre>Le code à dicter</Surtitre>
          <p className="chiffre text-6xl font-bold tracking-[0.2em] text-acide">{session.code}</p>
          <BoutonFantome className="mt-4 w-full" onClick={() => void partager()}>
            {copie ? 'Lien copié ✓' : 'Partager le lien'}
          </BoutonFantome>
        </Bloc>
      </Cascade>

      <Cascade index={1}>
        <div>
          <Surtitre>
            {joueurs.length} joueur{joueurs.length > 1 ? 's' : ''}
          </Surtitre>
          <div className="flex flex-wrap gap-2">
            {joueurs.map((joueur) => (
              <Pastille
                key={joueur.id}
                avatar={joueur.avatar}
                nom={joueur.nickname}
                actif={joueur.id === moi}
                suffixe={
                  joueur.id === session.host_player_id ? (
                    <span className="text-xs">👑</span>
                  ) : undefined
                }
              />
            ))}
          </div>
        </div>
      </Cascade>

      {session.mode === 'board' && (
        <Cascade index={2}>
          <PiocheDuPlateau effectif={joueurs.length} />
        </Cascade>
      )}

      {plateau && (
        <Cascade index={3}>
          <BoardView plateau={plateau} joueurs={joueurs} moi={moi} />
        </Cascade>
      )}

      <Cascade index={4}>
        {!hote ? (
          <Bloc className="text-center text-sm text-brume">
            L’hôte lance la prochaine manche.
          </Bloc>
        ) : session.mode === 'board' ? (
          <Bouton
            teinte="acide"
            disabled={joueurs.length < 2}
            onClick={() => void commande('start')}
          >
            {joueurs.length < 2 ? 'Il faut au moins deux joueurs' : 'Lancer la manche'}
          </Bouton>
        ) : (
          <div className="flex flex-col gap-2">
            <Surtitre>Choisis un jeu</Surtitre>
            {CATALOGUE.map((jeu) => {
              const assez = joueurs.length >= jeu.minPlayers
              return (
                <button
                  key={jeu.key}
                  type="button"
                  disabled={!assez}
                  onClick={() => void commande('start', jeu.key)}
                  className="flex items-center gap-3 rounded-2xl border-2 border-nuit-500 bg-nuit-800 px-4 py-3 text-left transition-colors hover:border-neon disabled:opacity-40"
                >
                  <span className="text-2xl">{jeu.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="titre block text-lg">{jeu.name}</span>
                    <span className="block truncate text-xs text-brume">
                      {assez ? jeu.tagline : `Il faut ${jeu.minPlayers} joueurs minimum.`}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </Cascade>
    </div>
  )
}

/**
 * Ce que le plateau peut tirer avec l'effectif présent.
 *
 * Sans cet affichage, une soirée à deux voit tourner Purple et Le Faux Départ
 * en boucle et croit à un bug, alors que Le Gardien et Tu préfères sont
 * simplement injouables à deux. Le seuil manquant doit se lire, pas se deviner.
 */
function PiocheDuPlateau({ effectif }: { effectif: number }) {
  const disponibles = CATALOGUE.filter((j) => effectif >= j.minPlayers)
  const manquants = CATALOGUE.filter((j) => effectif < j.minPlayers)
  const prochainSeuil = Math.min(...manquants.map((j) => j.minPlayers))

  return (
    <Bloc>
      <Surtitre>
        Pioche du plateau — {disponibles.length} jeu{disponibles.length > 1 ? 'x' : ''} sur{' '}
        {CATALOGUE.length}
      </Surtitre>

      <ul className="flex flex-col gap-1.5">
        {CATALOGUE.map((jeu) => {
          const jouable = effectif >= jeu.minPlayers
          return (
            <li
              key={jeu.key}
              className={[
                'flex items-center gap-2.5 text-sm',
                jouable ? 'text-craie' : 'text-brume/50',
              ].join(' ')}
            >
              <span className={jouable ? 'text-lg' : 'text-lg grayscale'}>{jeu.emoji}</span>
              <span className="flex-1 truncate">{jeu.name}</span>
              {!jouable && (
                <span className="chiffre shrink-0 text-[11px] uppercase text-rose">
                  dès {jeu.minPlayers}
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {manquants.length > 0 && (
        <p className="mt-3 border-t border-nuit-600 pt-3 text-xs text-brume">
          À {effectif}, seuls {disponibles.length} mini-jeux peuvent tomber. Il en faut{' '}
          <strong className="text-acide">{prochainSeuil}</strong> pour en débloquer d’autres.
        </p>
      )}
    </Bloc>
  )
}

function Paris({
  instantane,
  identite,
  moi,
}: {
  instantane: Instantane
  identite: Identite
  moi: string
}) {
  const { manche, joueurs } = instantane
  const [enCours, setEnCours] = useState(false)
  const dejaParie = manche?.bets[moi] !== undefined
  const fiche = manche ? ficheDe(manche.game_key) : undefined

  const parier = async (cible: string) => {
    if (!manche) return
    setEnCours(true)
    try {
      await api.parier(identite, manche.id, cible)
    } finally {
      setEnCours(false)
    }
  }

  if (!manche) return null

  return (
    <div className="flex flex-col gap-4">
      <Bloc vif className="text-center">
        <Surtitre>Tu ne joues pas cette manche</Surtitre>
        <p className="titre text-2xl">
          {fiche?.emoji} {fiche?.name}
        </p>
        <p className="mt-2 text-sm text-brume">
          Parie sur le vainqueur : une case si tu vois juste, une gorgée sinon.
        </p>
      </Bloc>

      {dejaParie ? (
        <Bloc className="text-center">
          <p className="text-sm">
            Tu as misé sur{' '}
            <strong className="text-acide">{nomDe(joueurs, manche.bets[moi] ?? '')}</strong>.
          </p>
        </Bloc>
      ) : (
        <div className="flex flex-col gap-2">
          {manche.participants.map((id) => (
            <button
              key={id}
              type="button"
              disabled={enCours}
              onClick={() => void parier(id)}
              className="flex min-h-14 items-center gap-3 rounded-2xl border-2 border-nuit-500 bg-nuit-800 px-4 transition-colors hover:border-acide active:scale-[0.98] disabled:opacity-50"
            >
              <span className="text-2xl">{avatarDe(joueurs, id)}</span>
              <span className="titre text-lg">{nomDe(joueurs, id)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Resultats({
  instantane,
  moi,
  hote,
  commande,
}: {
  instantane: Instantane
  moi: string
  hote: boolean
  commande: (action: 'start' | 'next' | 'lobby' | 'close-bets', gameKey?: string) => Promise<void>
}) {
  const { manche, joueurs, plateau, session } = instantane
  const resultat = manche?.result

  return (
    <div className="flex flex-col gap-4">
      <Cascade index={0}>
        <Bloc vif>
          <Surtitre>Manche terminée</Surtitre>
          {resultat ? (
            <ol className="mt-1 flex flex-col gap-2">
              {resultat.ranking.map((groupe, rang) =>
                groupe.map((id) => (
                  <li key={id} className="flex items-center gap-3">
                    <span className="titre w-8 text-2xl text-brume">{rang + 1}</span>
                    <span className="text-xl">{avatarDe(joueurs, id)}</span>
                    <span className={['flex-1 truncate', id === moi ? 'text-acide' : ''].join(' ')}>
                      {nomDe(joueurs, id)}
                    </span>
                    <span className="chiffre text-sm text-rose">
                      {resultat.sips[id] ? `${resultat.sips[id]} 🍺` : '—'}
                    </span>
                  </li>
                )),
              )}
            </ol>
          ) : (
            <p className="text-sm text-brume">Résultat en cours de calcul…</p>
          )}
        </Bloc>
      </Cascade>

      {plateau && (
        <Cascade index={1}>
          <BoardView plateau={plateau} joueurs={joueurs} moi={moi} />
        </Cascade>
      )}

      <Cascade index={2}>
        {hote ? (
          <Bouton teinte="acide" onClick={() => void commande('next')}>
            {session.mode === 'board' ? 'Manche suivante' : 'Retour au menu'}
          </Bouton>
        ) : (
          <p className="text-center text-sm text-brume">L’hôte enchaîne quand vous êtes prêts.</p>
        )}
      </Cascade>
    </div>
  )
}

function EffetEnAttente({
  pending,
  instantane,
  identite,
  moi,
}: {
  pending: { kind: 'tournee'; player: string; amount: number } | { kind: 'duel'; player: string }
  instantane: Instantane
  identite: Identite
  moi: string
}) {
  const { joueurs } = instantane
  const [repartition, setRepartition] = useState<Record<string, number>>({})
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const total = Object.values(repartition).reduce((a, b) => a + b, 0)
  const restant = (pending.kind === 'tournee' ? pending.amount : 0) - total

  const valider = async (payload: Parameters<typeof api.plateau>[1]) => {
    setEnCours(true)
    try {
      await api.plateau(identite, payload)
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Impossible.')
      setEnCours(false)
    }
  }

  if (pending.kind === 'duel') {
    return (
      <div className="flex flex-col gap-4">
        <Bloc vif className="text-center">
          <Surtitre>Case Duel</Surtitre>
          <p className="titre text-2xl">Qui veux-tu affronter ?</p>
          <p className="mt-2 text-sm text-brume">
            Vous vous affronterez au Faux Départ à la prochaine manche.
          </p>
        </Bloc>
        <div className="flex flex-col gap-2">
          {joueurs
            .filter((j) => j.id !== moi)
            .map((j) => (
              <button
                key={j.id}
                type="button"
                disabled={enCours}
                onClick={() => void valider({ kind: 'duel', opponent: j.id })}
                className="flex min-h-14 items-center gap-3 rounded-2xl border-2 border-nuit-500 bg-nuit-800 px-4 hover:border-cyan disabled:opacity-50"
              >
                <span className="text-2xl">{j.avatar}</span>
                <span className="titre text-lg">{j.nickname}</span>
              </button>
            ))}
        </div>
        {erreur && <p className="text-center text-sm text-rose">{erreur}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Bloc vif className="text-center">
        <Surtitre>Case Tournée</Surtitre>
        <p className="titre text-2xl">Distribue {TOURNEE_SIPS} gorgées</p>
        <p className="chiffre mt-2 text-sm text-brume">
          {restant > 0 ? `Encore ${restant} à placer` : 'Prêt'}
        </p>
      </Bloc>

      <div className="flex flex-col gap-2">
        {joueurs.map((j) => {
          const valeur = repartition[j.id] ?? 0
          return (
            <div
              key={j.id}
              className="flex items-center gap-3 rounded-2xl border-2 border-nuit-500 bg-nuit-800 px-4 py-2.5"
            >
              <span className="text-xl">{j.avatar}</span>
              <span className="flex-1 truncate text-sm">{j.nickname}</span>
              <button
                type="button"
                aria-label={`Retirer une gorgée à ${j.nickname}`}
                disabled={valeur === 0}
                onClick={() => setRepartition({ ...repartition, [j.id]: valeur - 1 })}
                className="grid size-9 place-items-center rounded-lg border-2 border-nuit-500 text-lg disabled:opacity-30"
              >
                −
              </button>
              <span className="chiffre w-6 text-center">{valeur}</span>
              <button
                type="button"
                aria-label={`Ajouter une gorgée à ${j.nickname}`}
                disabled={restant === 0}
                onClick={() => setRepartition({ ...repartition, [j.id]: valeur + 1 })}
                className="grid size-9 place-items-center rounded-lg border-2 border-nuit-500 text-lg disabled:opacity-30"
              >
                +
              </button>
            </div>
          )
        })}
      </div>

      {erreur && <p className="text-center text-sm text-rose">{erreur}</p>}

      <Bouton
        teinte="or"
        disabled={restant !== 0 || enCours}
        onClick={() => void valider({ kind: 'tournee', distribution: repartition })}
      >
        Servir la tournée
      </Bouton>
    </div>
  )
}
