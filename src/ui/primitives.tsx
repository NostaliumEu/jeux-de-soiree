'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type Teinte = 'neon' | 'acide' | 'rose' | 'cyan' | 'or' | 'brume'

const FONDS: Record<Teinte, string> = {
  neon: 'bg-neon text-nuit-900',
  acide: 'bg-acide text-nuit-900',
  rose: 'bg-rose text-nuit-900',
  cyan: 'bg-cyan text-nuit-900',
  or: 'bg-or text-nuit-900',
  brume: 'bg-nuit-600 text-craie',
}

const OMBRES: Record<Teinte, string> = {
  neon: 'shadow-[4px_4px_0_0_#5b1a8c]',
  acide: 'shadow-[4px_4px_0_0_#6f8f1a]',
  rose: 'shadow-[4px_4px_0_0_#8c1a4b]',
  cyan: 'shadow-[4px_4px_0_0_#1a7a8c]',
  or: 'shadow-[4px_4px_0_0_#8c6a1a]',
  brume: 'shadow-[4px_4px_0_0_#07040d]',
}

interface BoutonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  teinte?: Teinte
  pleine?: boolean
  children: ReactNode
}

/**
 * Bouton à ombre dure qui s'enfonce au contact. Hauteur minimale de 56 px :
 * on vise ça sur un téléphone, dans le noir, après quelques verres.
 */
export function Bouton({
  teinte = 'neon',
  pleine = true,
  className = '',
  children,
  ...props
}: BoutonProps) {
  return (
    <button
      {...props}
      className={[
        'titre relative min-h-14 rounded-2xl px-6 text-lg uppercase tracking-tight',
        'border-2 border-nuit-900/40 transition-transform duration-100',
        'active:translate-x-[3px] active:translate-y-[3px] active:shadow-none',
        'disabled:pointer-events-none disabled:opacity-35',
        pleine ? 'w-full' : '',
        FONDS[teinte],
        OMBRES[teinte],
        className,
      ].join(' ')}
    >
      {children}
    </button>
  )
}

export function BoutonFantome({
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      {...props}
      className={[
        'min-h-12 rounded-2xl border-2 border-nuit-500 px-5 text-sm font-semibold uppercase',
        'tracking-wide text-brume transition-colors',
        'hover:border-neon hover:text-craie active:bg-nuit-700',
        'disabled:pointer-events-none disabled:opacity-35',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  )
}

export function Bloc({
  vif = false,
  className = '',
  children,
}: {
  vif?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div className={['bloc p-5', vif ? 'bloc-vif' : '', className].join(' ')}>{children}</div>
  )
}

export function Surtitre({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1 text-xs font-bold uppercase tracking-[0.22em] text-brume">{children}</p>
  )
}

export function Pastille({
  avatar,
  nom,
  actif = false,
  suffixe,
}: {
  avatar: string
  nom: string
  actif?: boolean
  suffixe?: ReactNode
}) {
  return (
    <div
      className={[
        'flex items-center gap-2 rounded-full border-2 py-1.5 pl-1.5 pr-3.5 transition-colors',
        actif ? 'border-acide bg-acide/12 text-craie' : 'border-nuit-500 text-brume',
      ].join(' ')}
    >
      <span className="grid size-8 place-items-center rounded-full bg-nuit-700 text-lg leading-none">
        {avatar}
      </span>
      <span className="max-w-28 truncate text-sm font-semibold">{nom}</span>
      {suffixe}
    </div>
  )
}

/** Décalage d'apparition, pour que les blocs entrent en cascade. */
export function Cascade({ index, children }: { index: number; children: ReactNode }) {
  return (
    <div className="animate-montee" style={{ animationDelay: `${index * 70}ms` }}>
      {children}
    </div>
  )
}
