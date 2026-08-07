'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AVATARS } from '@/shared/avatars'
import { CATALOGUE } from '@/shared/jeux'
import { api, ecrireIdentite } from '@/client/api'
import { Bloc, Bouton, Cascade, Surtitre } from '@/ui/primitives'

type Onglet = 'creer' | 'rejoindre'

export default function Accueil() {
  const router = useRouter()
  const [onglet, setOnglet] = useState<Onglet>('creer')
  const [pseudo, setPseudo] = useState('')
  const [avatar, setAvatar] = useState<string>(AVATARS[0])
  const [mode, setMode] = useState<'free' | 'board'>('free')
  const [manches, setManches] = useState(15)
  const [code, setCode] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  const valider = async () => {
    setErreur(null)
    setEnCours(true)
    try {
      const arrivee =
        onglet === 'creer'
          ? await api.creer(pseudo.trim(), avatar, mode, mode === 'board' ? manches : undefined)
          : await api.rejoindre(code.trim(), pseudo.trim(), avatar)

      ecrireIdentite({
        code: arrivee.code,
        sessionId: arrivee.sessionId,
        playerId: arrivee.playerId,
        token: arrivee.token,
      })
      router.push(`/j/${arrivee.code}`)
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Quelque chose a mal tourné.')
      setEnCours(false)
    }
  }

  const pret = pseudo.trim().length > 0 && (onglet === 'creer' || code.trim().length === 4)

  return (
    <main className="zone-sure mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 pt-10">
      <Cascade index={0}>
        <header className="mb-2">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-neon">
            À boire, à jouer
          </p>
          <h1 className="titre mt-1 text-6xl">
            JEUX
            <br />
            DE <span className="text-acide">SOIRÉE</span>
          </h1>
          <p className="mt-3 text-sm text-brume">
            Un lien, un code à quatre lettres, et tout le monde joue sur son téléphone.
            Aucune inscription.
          </p>
        </header>
      </Cascade>

      <Cascade index={1}>
        <div className="grid grid-cols-2 gap-2 rounded-2xl border-2 border-nuit-500 bg-nuit-800 p-1.5">
          {(
            [
              ['creer', 'Créer'],
              ['rejoindre', 'Rejoindre'],
            ] as const
          ).map(([cle, libelle]) => (
            <button
              key={cle}
              type="button"
              onClick={() => setOnglet(cle)}
              className={[
                'titre min-h-11 rounded-xl text-base uppercase transition-colors',
                onglet === cle ? 'bg-neon text-nuit-900' : 'text-brume',
              ].join(' ')}
            >
              {libelle}
            </button>
          ))}
        </div>
      </Cascade>

      <Cascade index={2}>
        <Bloc className="flex flex-col gap-4">
          <div>
            <Surtitre>Ton pseudo</Surtitre>
            <input
              value={pseudo}
              onChange={(e) => setPseudo(e.target.value)}
              maxLength={20}
              placeholder="Kévin"
              className="w-full rounded-xl border-2 border-nuit-500 bg-nuit-900 px-4 py-3 text-lg outline-none placeholder:text-brume/50 focus:border-neon"
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
                    'grid aspect-square place-items-center rounded-lg border-2 text-xl transition-transform',
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

          {onglet === 'rejoindre' ? (
            <div>
              <Surtitre>Code de la soirée</Surtitre>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
                placeholder="ABCD"
                autoCapitalize="characters"
                autoComplete="off"
                className="chiffre w-full rounded-xl border-2 border-nuit-500 bg-nuit-900 px-4 py-3 text-center text-3xl uppercase outline-none placeholder:text-brume/40 focus:border-acide"
              />
            </div>
          ) : (
            <>
              <div>
                <Surtitre>Comment vous jouez</Surtitre>
                <div className="flex flex-col gap-2">
                  {(
                    [
                      ['free', 'Sélection libre', 'Vous choisissez un jeu, vous y jouez, vous revenez au menu.'],
                      ['board', 'Plateau', 'Un parcours en boucle : les mini-jeux font avancer les pions.'],
                    ] as const
                  ).map(([cle, titre, texte]) => (
                    <button
                      key={cle}
                      type="button"
                      onClick={() => setMode(cle)}
                      className={[
                        'rounded-xl border-2 px-4 py-3 text-left transition-colors',
                        mode === cle
                          ? 'border-acide bg-acide/10'
                          : 'border-nuit-500 bg-nuit-900 hover:border-neon',
                      ].join(' ')}
                    >
                      <p className="titre text-lg">{titre}</p>
                      <p className="mt-0.5 text-xs text-brume">{texte}</p>
                    </button>
                  ))}
                </div>
              </div>

              {mode === 'board' && (
                <div>
                  <Surtitre>Nombre de manches</Surtitre>
                  <div className="grid grid-cols-3 gap-2">
                    {[10, 15, 20].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setManches(n)}
                        className={[
                          'chiffre min-h-12 rounded-xl border-2 text-lg transition-colors',
                          manches === n
                            ? 'border-or bg-or/15 text-or'
                            : 'border-nuit-500 text-brume',
                        ].join(' ')}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </Bloc>
      </Cascade>

      {erreur && (
        <p className="rounded-xl border-2 border-rose bg-rose/10 px-4 py-3 text-sm text-rose">
          {erreur}
        </p>
      )}

      <Cascade index={3}>
        <Bouton teinte="acide" disabled={!pret || enCours} onClick={() => void valider()}>
          {enCours ? 'Un instant…' : onglet === 'creer' ? 'Ouvrir la soirée' : 'Rejoindre'}
        </Bouton>
      </Cascade>

      <Cascade index={4}>
        <section className="mt-2">
          <Surtitre>Ce soir au programme</Surtitre>
          <ul className="flex flex-col gap-2">
            {CATALOGUE.map((jeu) => (
              <li
                key={jeu.key}
                className="flex items-start gap-3 rounded-xl border-2 border-nuit-600 px-3 py-2.5"
              >
                <span className="text-xl">{jeu.emoji}</span>
                <div className="min-w-0">
                  <p className="titre text-base">{jeu.name}</p>
                  <p className="text-xs text-brume">{jeu.tagline}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </Cascade>

      <p className="mt-auto pt-6 text-center text-xs text-brume/60">
        Jeu à boire entre amis. Le code est ouvert : ajoute tes propres jeux.
      </p>
    </main>
  )
}
