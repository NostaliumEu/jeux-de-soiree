'use client'

import { useState } from 'react'
import { Minuteur } from '@/ui/Minuteur'
import { Bloc, Bouton, Pastille, Surtitre } from '@/ui/primitives'
import { avatarDe, nomDe, type EcranProps } from '@/client/types'
import { IMPOSTEUR_MAX_INDICE } from './definition'
import type { ImposteurPublic } from './machine'

interface VuePrivee {
  mot?: string
  monVote?: string | null
}

export function ImposteurEcran({
  etat,
  moi,
  joueurs,
  decalage,
  vuePrivee,
  envoyer,
}: EcranProps<ImposteurPublic>) {
  const [brouillon, setBrouillon] = useState('')
  const [enCours, setEnCours] = useState(false)

  const prive = (vuePrivee ?? {}) as VuePrivee
  const participe = etat.participants.includes(moi)
  const tour = etat.order[etat.currentIndex]
  const monTour = tour === moi && etat.phase === 'indice'
  const aVote = etat.voted.includes(moi)

  const donnerIndice = async () => {
    const mot = brouillon.trim()
    if (!mot) return
    setEnCours(true)
    try {
      await envoyer({ type: 'indice', mot })
      setBrouillon('')
    } finally {
      setEnCours(false)
    }
  }

  const accuser = async (suspect: string) => {
    setEnCours(true)
    try {
      await envoyer({ type: 'vote', suspect })
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Ton mot, et rien d'autre. Tu ne sais pas si c'est le bon. */}
      {participe && prive.mot && etat.phase !== 'over' && (
        <Bloc vif className="text-center">
          <Surtitre>Ton mot</Surtitre>
          <p className="titre text-5xl leading-tight text-acide">{prive.mot}</p>
          <p className="mt-2 text-xs text-brume">
            Quelqu’un autour de la table n’a pas le même. Peut-être toi.
          </p>
        </Bloc>
      )}

      {etat.phase === 'indice' && (
        <>
          <Bloc className="flex items-center justify-between">
            <div>
              <Surtitre>Indices</Surtitre>
              <p className="titre text-lg">
                {monTour ? 'À toi de parler' : `On écoute ${nomDe(joueurs, tour ?? '')}`}
              </p>
            </div>
            <Minuteur echeance={etat.deadlineAt} decalage={decalage} />
          </Bloc>

          {monTour && (
            <div className="flex flex-col gap-2">
              <input
                value={brouillon}
                onChange={(e) => setBrouillon(e.target.value)}
                maxLength={IMPOSTEUR_MAX_INDICE}
                placeholder="Un seul mot…"
                autoComplete="off"
                className="w-full rounded-xl border-2 border-nuit-500 bg-nuit-900 px-4 py-3 text-center text-xl outline-none focus:border-acide"
              />
              <Bouton
                teinte="acide"
                disabled={enCours || brouillon.trim().length === 0}
                onClick={() => void donnerIndice()}
              >
                Donner mon indice
              </Bouton>
              <p className="text-center text-xs text-brume">
                Trop précis, tu te trahis. Trop vague, on te soupçonne.
              </p>
            </div>
          )}
        </>
      )}

      {etat.indices.length > 0 && (
        <Bloc>
          <Surtitre>Ce qui a été dit</Surtitre>
          <ol className="flex flex-col gap-2">
            {etat.indices.map((indice, i) => (
              <li key={i} className="flex items-center gap-2.5">
                <span className="text-lg">{avatarDe(joueurs, indice.player)}</span>
                <span className="w-20 shrink-0 truncate text-sm text-brume">
                  {nomDe(joueurs, indice.player)}
                </span>
                <span className="titre flex-1 truncate text-lg">{indice.mot}</span>
              </li>
            ))}
          </ol>
        </Bloc>
      )}

      {etat.phase === 'vote' && (
        <>
          <Bloc vif className="flex items-center justify-between">
            <p className="titre text-xl">Qui est l’imposteur ?</p>
            <Minuteur echeance={etat.deadlineAt} decalage={decalage} />
          </Bloc>

          {participe && !aVote ? (
            <div className="grid grid-cols-2 gap-2.5">
              {etat.participants
                .filter((id) => id !== moi)
                .map((id) => (
                  <button
                    key={id}
                    type="button"
                    disabled={enCours}
                    onClick={() => void accuser(id)}
                    className="flex min-h-16 items-center gap-2 rounded-2xl border-2 border-nuit-500 bg-nuit-800 px-3 text-left transition-colors hover:border-rose active:scale-95 disabled:opacity-50"
                  >
                    <span className="text-xl">{avatarDe(joueurs, id)}</span>
                    <span className="truncate text-sm font-semibold">{nomDe(joueurs, id)}</span>
                  </button>
                ))}
            </div>
          ) : (
            <p className="text-center text-sm text-brume">
              {aVote
                ? `Vote enregistré. On attend ${etat.participants.length - etat.voted.length} personne${
                    etat.participants.length - etat.voted.length > 1 ? 's' : ''
                  }.`
                : 'Tu ne participes pas à cette manche.'}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {etat.participants.map((id) => (
              <Pastille
                key={id}
                avatar={avatarDe(joueurs, id)}
                nom={nomDe(joueurs, id)}
                actif={etat.voted.includes(id)}
              />
            ))}
          </div>
        </>
      )}

      {etat.phase === 'over' && etat.imposteur && (
        <Bloc vif className="text-center">
          <Surtitre>{etat.demasque ? 'Démasqué' : 'Passé entre les gouttes'}</Surtitre>
          <p className="titre my-1 text-4xl">
            {avatarDe(joueurs, etat.imposteur)} {nomDe(joueurs, etat.imposteur)}
          </p>
          <p className="text-sm text-brume">
            Le mot commun était <strong className="text-craie">{etat.motCommun}</strong>, le sien{' '}
            <strong className="text-rose">{etat.motImposteur}</strong>.
          </p>

          <ul className="mt-4 flex flex-col gap-1 border-t border-nuit-600 pt-3 text-sm">
            {Object.entries(etat.votes).map(([votant, suspect]) => (
              <li key={votant} className="flex justify-between gap-2">
                <span className="truncate text-brume">{nomDe(joueurs, votant)}</span>
                <span
                  className={['truncate', suspect === etat.imposteur ? 'text-acide' : ''].join(' ')}
                >
                  accuse {nomDe(joueurs, suspect)}
                </span>
              </li>
            ))}
          </ul>
        </Bloc>
      )}
    </div>
  )
}
