'use client'

import { useState } from 'react'
import { Minuteur } from '@/ui/Minuteur'
import { Bloc, Bouton, Surtitre } from '@/ui/primitives'
import { avatarDe, nomDe, type EcranProps } from '@/client/types'
import type { TuPreferesPublic } from './machine'

export function TuPreferesEcran({
  etat,
  moi,
  joueurs,
  decalage,
  envoyer,
}: EcranProps<TuPreferesPublic>) {
  const [enCours, setEnCours] = useState(false)
  const question = etat.current
  const aVote = etat.voted.includes(moi)
  const participe = etat.participants.includes(moi)
  const derniere = etat.history[etat.history.length - 1]

  const voter = async (choix: string) => {
    setEnCours(true)
    try {
      await envoyer({ type: 'vote', choice: choix })
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Bloc className="flex items-center justify-between">
        <Surtitre>
          Question {Math.min(etat.index + 1, etat.total)} sur {etat.total}
        </Surtitre>
        <Minuteur echeance={etat.deadlineAt} decalage={decalage} />
      </Bloc>

      {question && (
        <Bloc vif>
          <p className="titre text-center text-2xl leading-tight">
            {question.type === 'binaire' ? 'Tu préfères…' : 'Qui est le plus susceptible…'}
          </p>
          {question.type === 'joueur' && (
            <p className="mt-2 text-center text-lg text-craie">{question.text} ?</p>
          )}
        </Bloc>
      )}

      {question && participe && !aVote && etat.phase === 'vote' && (
        <div className="flex flex-col gap-2.5">
          {question.type === 'binaire' ? (
            <>
              <Bouton teinte="cyan" disabled={enCours} onClick={() => void voter('a')}>
                {question.a}
              </Bouton>
              <p className="text-center text-xs uppercase tracking-widest text-brume">ou</p>
              <Bouton teinte="rose" disabled={enCours} onClick={() => void voter('b')}>
                {question.b}
              </Bouton>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {etat.participants.map((id) => (
                <button
                  key={id}
                  type="button"
                  disabled={enCours}
                  onClick={() => void voter(id)}
                  className="flex min-h-16 items-center gap-2 rounded-2xl border-2 border-nuit-500 bg-nuit-800 px-3 text-left transition-colors hover:border-neon active:scale-95 disabled:opacity-50"
                >
                  <span className="text-xl">{avatarDe(joueurs, id)}</span>
                  <span className="truncate text-sm font-semibold">{nomDe(joueurs, id)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {aVote && (
        <p className="text-center text-sm text-brume">
          Vote enregistré. On attend {etat.participants.length - etat.voted.length} personne
          {etat.participants.length - etat.voted.length > 1 ? 's' : ''}.
        </p>
      )}

      {!participe && (
        <p className="text-center text-sm text-brume">Tu ne participes pas à cette manche.</p>
      )}

      {derniere && (
        <Bloc>
          <Surtitre>Question précédente</Surtitre>
          <p className="mb-2 text-sm text-craie">{derniere.verdict}</p>
          <ul className="flex flex-col gap-1 text-sm">
            {Object.entries(derniere.votes).map(([votant, choix]) => (
              <li key={votant} className="flex justify-between gap-2">
                <span className="truncate text-brume">{nomDe(joueurs, votant)}</span>
                <span className="truncate">
                  {derniere.question.type === 'binaire'
                    ? choix === 'a'
                      ? derniere.question.a
                      : derniere.question.b
                    : nomDe(joueurs, choix)}
                </span>
              </li>
            ))}
          </ul>
        </Bloc>
      )}

      <Bloc>
        <Surtitre>Gorgées de la manche</Surtitre>
        <ul className="flex flex-col gap-1 text-sm">
          {etat.participants.map((id) => (
            <li key={id} className="flex justify-between">
              <span>{nomDe(joueurs, id)}</span>
              <span className="chiffre">{etat.sips[id] ?? 0}</span>
            </li>
          ))}
        </ul>
      </Bloc>
    </div>
  )
}
