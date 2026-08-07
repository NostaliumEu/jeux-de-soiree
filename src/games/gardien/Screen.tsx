'use client'

import { useState } from 'react'
import { Minuteur } from '@/ui/Minuteur'
import { Bloc, Pastille, Surtitre } from '@/ui/primitives'
import { avatarDe, nomDe, type EcranProps } from '@/client/types'
import { CORNER_LABELS, type Corner, type GardienPublic } from './machine'

/** Disposition du but : les quatre coins, et le centre au milieu du bas. */
const GRILLE: Array<{ coin: Corner; classe: string }> = [
  { coin: 'HG', classe: 'col-start-1 row-start-1' },
  { coin: 'HD', classe: 'col-start-2 row-start-1' },
  { coin: 'BG', classe: 'col-start-1 row-start-2' },
  { coin: 'BD', classe: 'col-start-2 row-start-2' },
  { coin: 'C', classe: 'col-span-2 col-start-1 row-start-3' },
]

export function GardienEcran({
  etat,
  moi,
  joueurs,
  decalage,
  vuePrivee,
  envoyer,
}: EcranProps<GardienPublic>) {
  const [enCours, setEnCours] = useState(false)
  const gardien = etat.keeper === moi
  const participe = gardien || etat.shooters.includes(moi)
  const dejaChoisi = etat.chosen.includes(moi)
  const monCoin = (vuePrivee as { myCorner?: Corner } | null)?.myCorner ?? null
  const derniere = etat.history[etat.history.length - 1]

  const choisir = async (coin: Corner) => {
    setEnCours(true)
    try {
      await envoyer({ type: 'choose', corner: coin })
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Bloc vif className="flex items-center justify-between">
        <div>
          <Surtitre>Manche {Math.min(etat.round, 3)} sur 3</Surtitre>
          <p className="titre text-xl">
            {gardien ? 'Tu gardes les buts' : participe ? 'À toi de tirer' : 'Tu regardes'}
          </p>
        </div>
        <Minuteur echeance={etat.deadlineAt} decalage={decalage} />
      </Bloc>

      <div className="flex flex-wrap items-center gap-2">
        <Pastille
          avatar={avatarDe(joueurs, etat.keeper)}
          nom={nomDe(joueurs, etat.keeper)}
          actif={etat.chosen.includes(etat.keeper)}
          suffixe={<span className="text-xs">🧤</span>}
        />
        {etat.shooters.map((tireur) => (
          <Pastille
            key={tireur}
            avatar={avatarDe(joueurs, tireur)}
            nom={nomDe(joueurs, tireur)}
            actif={etat.chosen.includes(tireur)}
          />
        ))}
      </div>

      {participe && etat.phase === 'choose' && (
        <div className="grid grid-cols-2 grid-rows-3 gap-2.5">
          {GRILLE.map(({ coin, classe }) => {
            const choisiParMoi = monCoin === coin
            return (
              <button
                key={coin}
                type="button"
                disabled={enCours || dejaChoisi}
                onClick={() => void choisir(coin)}
                className={[
                  classe,
                  'min-h-24 rounded-2xl border-2 px-3 text-sm font-semibold uppercase',
                  'transition-all active:scale-95 disabled:opacity-60',
                  choisiParMoi
                    ? 'border-acide bg-acide/20 text-acide'
                    : 'border-nuit-500 bg-nuit-800 text-brume hover:border-neon',
                ].join(' ')}
              >
                {CORNER_LABELS[coin]}
              </button>
            )
          })}
        </div>
      )}

      {dejaChoisi && (
        <p className="text-center text-sm text-brume">
          Choix enregistré. Personne ne le voit tant que tout le monde n’a pas joué.
        </p>
      )}

      {derniere && (
        <Bloc>
          <Surtitre>Manche {derniere.round}</Surtitre>
          <p className="mb-2 text-sm">
            Le gardien a plongé en{' '}
            <strong className="text-cyan">{CORNER_LABELS[derniere.keeperCorner]}</strong>
          </p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {derniere.shots.map((tir) => (
              <li key={tir.shooter} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {nomDe(joueurs, tir.shooter)} · {CORNER_LABELS[tir.corner]}
                </span>
                <span className={tir.saved ? 'font-bold text-rose' : 'font-bold text-acide'}>
                  {tir.saved ? 'ARRÊTÉ' : 'BUT'}
                </span>
              </li>
            ))}
          </ul>
        </Bloc>
      )}

      <Bloc>
        <Surtitre>Points</Surtitre>
        <ul className="flex flex-col gap-1 text-sm">
          {[etat.keeper, ...etat.shooters].map((id) => (
            <li key={id} className="flex justify-between">
              <span>{nomDe(joueurs, id)}</span>
              <span className="chiffre">
                {etat.points[id] ?? 0} pt · {etat.sips[id] ?? 0} gorgées
              </span>
            </li>
          ))}
        </ul>
      </Bloc>
    </div>
  )
}
