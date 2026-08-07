'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoardState } from '@/modes/board/machine'
import { browserClient } from './supabase'
import type { Instantane, JoueurPublic, SessionPublique, manchePublique } from './types'

/**
 * Abonnement temps réel à une soirée.
 *
 * Plutôt que d'appliquer des correctifs incrémentaux (source intarissable de
 * désynchronisations quand un téléphone s'endort trente secondes), on recharge
 * l'instantané complet à chaque notification. Une soirée compte quelques
 * dizaines de lignes : le coût est négligeable et l'état est toujours juste.
 */
export function useSession(code: string) {
  const [instantane, setInstantane] = useState<Instantane | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [chargement, setChargement] = useState(true)
  const roundIdRef = useRef<string | null>(null)

  const charger = useCallback(async () => {
    try {
      const db = browserClient()

      const { data: session, error } = await db
        .from('sessions')
        .select('*')
        .eq('code', code.toUpperCase())
        .maybeSingle()

      if (error) throw error
      if (!session) {
        setErreur(`Aucune soirée ne porte le code ${code.toUpperCase()}.`)
        setInstantane(null)
        return
      }

      const s = session as SessionPublique

      // Une seule vague : l'identifiant de manche est déjà connu, il n'y a
      // aucune raison d'attendre les autres requêtes pour lire son état.
      const vide = Promise.resolve({ data: null, error: null })
      const [joueurs, manche, plateau, gorgees, etat] = await Promise.all([
        db.from('players').select('*').eq('session_id', s.id).order('joined_at'),
        s.current_round_id
          ? db.from('rounds').select('*').eq('id', s.current_round_id).maybeSingle()
          : vide,
        db.from('board_state').select('state').eq('session_id', s.id).maybeSingle(),
        db.from('tally').select('player_id, sips_total').eq('session_id', s.id),
        s.current_round_id
          ? db
              .from('round_public_state')
              .select('public_state, version')
              .eq('round_id', s.current_round_id)
              .maybeSingle()
          : vide,
      ])

      const compte: Record<string, number> = {}
      for (const ligne of gorgees.data ?? []) {
        compte[ligne.player_id as string] = ligne.sips_total as number
      }

      roundIdRef.current = s.current_round_id
      setErreur(null)
      setInstantane({
        session: s,
        joueurs: (joueurs.data ?? []) as JoueurPublic[],
        manche: (manche.data as manchePublique | null) ?? null,
        etatPublic: (etat.data?.public_state as Record<string, unknown>) ?? null,
        version: (etat.data?.version as number) ?? 0,
        plateau: (plateau.data?.state as BoardState | null) ?? null,
        gorgees: compte,
      })
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Connexion impossible.')
    } finally {
      setChargement(false)
    }
  }, [code])

  useEffect(() => {
    void charger()
  }, [charger])

  // Abonnement aux tables de la soirée. `charger` est débattu par un court
  // délai pour absorber les rafales (une manche qui se termine écrit dans
  // quatre tables d'affilée).
  const sessionId = instantane?.session.id
  useEffect(() => {
    if (!sessionId) return

    const db = browserClient()
    let minuterie: ReturnType<typeof setTimeout> | null = null

    const rafraichir = () => {
      if (minuterie) clearTimeout(minuterie)
      minuterie = setTimeout(() => void charger(), 80)
    }

    const canal = db
      .channel(`soiree:${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, rafraichir)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `session_id=eq.${sessionId}` }, rafraichir)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds', filter: `session_id=eq.${sessionId}` }, rafraichir)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_state', filter: `session_id=eq.${sessionId}` }, rafraichir)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tally', filter: `session_id=eq.${sessionId}` }, rafraichir)
      .subscribe()

    return () => {
      if (minuterie) clearTimeout(minuterie)
      void db.removeChannel(canal)
    }
  }, [sessionId, charger])

  // L'état d'une manche vit dans sa propre table, sans colonne `session_id` :
  // on rebranche donc un canal dédié à chaque changement de manche.
  const roundId = instantane?.session.current_round_id
  useEffect(() => {
    if (!roundId) return

    const db = browserClient()
    const canal = db
      .channel(`manche:${roundId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'round_public_state',
          filter: `round_id=eq.${roundId}`,
        },
        () => void charger(),
      )
      .subscribe()

    return () => {
      void db.removeChannel(canal)
    }
  }, [roundId, charger])

  // Filet de sécurité : si le socket meurt en silence (téléphone verrouillé,
  // changement de réseau), on resynchronise quand même. Inutile de le faire
  // quand l'écran est éteint : ça ne ferait que vider la batterie.
  useEffect(() => {
    const battement = setInterval(() => {
      if (document.visibilityState === 'visible') void charger()
    }, 20_000)

    const reveil = () => {
      if (document.visibilityState === 'visible') void charger()
    }
    document.addEventListener('visibilitychange', reveil)
    window.addEventListener('online', reveil)

    return () => {
      clearInterval(battement)
      document.removeEventListener('visibilitychange', reveil)
      window.removeEventListener('online', reveil)
    }
  }, [charger])

  /**
   * Applique sans délai l'état renvoyé par le serveur au joueur qui vient
   * d'agir. Sans ça, il verrait sa propre carte avec un temps de retard : le
   * temps que l'écriture parte en base, que Realtime la diffuse et qu'on
   * recharge l'instantané.
   */
  const appliquerEtat = useCallback((etat: Record<string, unknown>) => {
    setInstantane((precedent) =>
      precedent ? { ...precedent, etatPublic: etat, version: precedent.version + 1 } : precedent,
    )
  }, [])

  return { instantane, erreur, chargement, recharger: charger, appliquerEtat }
}
