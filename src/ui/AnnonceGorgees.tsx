'use client'

import { useEffect } from 'react'
import { avatarDe, nomDe, type JoueurPublic } from '@/client/types'

export interface Buveur {
  id: string
  montant: number
}

/** Durée d'affichage : assez pour être vu de l'autre bout de la table, assez court pour ne pas gêner. */
const DUREE_PLEIN_ECRAN = 7_000
const DUREE_DISCRET = 4_000

/**
 * Annonce des gorgées.
 *
 * Plein écran quand c'est toi qui bois : dans une pièce sombre, avec de la
 * musique et quelques verres, une ligne de texte discrète passe inaperçue et
 * personne ne boit. Pour les autres, un bandeau léger suffit — il tient la
 * table au courant sans interrompre celui qui n'est pas concerné.
 */
export function AnnonceGorgees({
  buveurs,
  moi,
  joueurs,
  surFermeture,
}: {
  buveurs: Buveur[]
  moi: string
  joueurs: JoueurPublic[]
  surFermeture: () => void
}) {
  const maPart = buveurs.find((b) => b.id === moi)
  const autres = buveurs.filter((b) => b.id !== moi)

  useEffect(() => {
    const delai = maPart ? DUREE_PLEIN_ECRAN : DUREE_DISCRET
    const timer = setTimeout(surFermeture, delai)
    return () => clearTimeout(timer)
  }, [maPart, surFermeture, buveurs])

  if (buveurs.length === 0) return null

  // Personne d'autre que moi : bandeau seulement.
  if (!maPart) {
    return (
      <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center px-4 pt-3">
        <div className="animate-montee flex max-w-md items-center gap-2 rounded-full border-2 border-rose/70 bg-nuit-800/95 px-4 py-2 shadow-[0_4px_0_0_#07040d] backdrop-blur">
          {autres.slice(0, 3).map((b) => (
            <span key={b.id} className="flex items-center gap-1.5 text-sm">
              <span className="text-lg leading-none">{avatarDe(joueurs, b.id)}</span>
              <span className="max-w-24 truncate font-semibold">{nomDe(joueurs, b.id)}</span>
              <span className="chiffre font-bold text-rose">{b.montant}</span>
            </span>
          ))}
          {autres.length > 3 && (
            <span className="text-xs text-brume">+{autres.length - 3}</span>
          )}
          <span className="text-base">🍺</span>
        </div>
      </div>
    )
  }

  return (
    <div
      role="alertdialog"
      aria-label={`Tu bois ${maPart.montant} gorgées`}
      onClick={surFermeture}
      className="animate-montee fixed inset-0 z-50 flex flex-col items-center justify-center bg-nuit-900/95 px-6 backdrop-blur-sm"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(28rem 28rem at 50% 45%, color-mix(in oklab, var(--color-rose) 45%, transparent), transparent 70%)',
        }}
      />

      <div className="relative flex flex-col items-center text-center">
        <p className="titre text-2xl uppercase tracking-[0.3em] text-rose">Tu bois</p>

        <p className="titre my-2 text-[8rem] leading-none text-craie drop-shadow-[0_6px_0_rgba(0,0,0,0.5)]">
          {maPart.montant}
        </p>

        <p className="titre text-3xl uppercase text-craie">
          gorgée{maPart.montant > 1 ? 's' : ''}
        </p>

        {autres.length > 0 && (
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            <span className="text-xs uppercase tracking-widest text-brume">Avec toi</span>
            {autres.map((b) => (
              <span
                key={b.id}
                className="flex items-center gap-1.5 rounded-full border border-nuit-500 px-3 py-1 text-sm"
              >
                <span>{avatarDe(joueurs, b.id)}</span>
                <span className="max-w-20 truncate">{nomDe(joueurs, b.id)}</span>
                <span className="chiffre text-rose">{b.montant}</span>
              </span>
            ))}
          </div>
        )}

        <p className="mt-10 text-xs uppercase tracking-[0.25em] text-brume">
          Touche pour continuer
        </p>
      </div>
    </div>
  )
}
