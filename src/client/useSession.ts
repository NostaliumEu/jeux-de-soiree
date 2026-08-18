'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoardState } from '@/modes/board/machine'
import { browserClient } from './supabase'
import type { Instantane, JoueurPublic, SessionPublique, manchePublique } from './types'

/**
 * Abonnement temps réel à une soirée.
 *
 * Deux régimes, selon la fréquence d'écriture.
 *
 * Les tables calmes — la soirée, les joueurs, le plateau, les gorgées —
 * déclenchent un rechargement complet de l'instantané : c'est simple, robuste,
 * et quelques dizaines de lignes ne coûtent rien.
 *
 * L'état de la manche, lui, est écrit plusieurs fois par seconde. Sa
 * notification porte déjà la ligne entière : on l'applique telle quelle, en
 * refusant celles plus anciennes que ce qui est affiché.
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

  /**
   * Installe un nouvel état de manche, qu'il vienne du temps réel ou de la
   * réponse à sa propre action. Dans ce second cas, l'affichage n'attend pas
   * l'aller-retour du socket : on voit sa carte immédiatement.
   */
  const appliquerEtat = useCallback((etat: Record<string, unknown>, version: number) => {
    setInstantane((precedent) => {
      if (!precedent) return precedent
      // Un état plus ancien que celui affiché est ignoré. Sans ce garde-fou,
      // la réponse à MON action réinstallait un instantané antérieur aux coups
      // joués entre-temps par les autres : leurs jauges se figeaient ou
      // reculaient, ce qui donnait toute l'impression d'une désynchronisation.
      if (version <= precedent.version) return precedent
      return { ...precedent, etatPublic: etat, version }
    })
  }, [])

  // L'état d'une manche vit dans sa propre table, sans colonne `session_id` :
  // on rebranche donc un canal dédié à chaque changement de manche.
  //
  // Ici on APPLIQUE la ligne reçue au lieu de recharger tout l'instantané.
  // C'est la table la plus écrite de loin — pendant un Sprint à quatre, une
  // quinzaine de fois par seconde — et déclencher cinq requêtes à chaque
  // notification saturait les téléphones pour rien : la notification contient
  // déjà exactement ce qu'on allait redemander.
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
        (message) => {
          const ligne = message.new as
            | { public_state?: Record<string, unknown>; version?: number }
            | undefined
          if (ligne?.public_state && typeof ligne.version === 'number') {
            appliquerEtat(ligne.public_state, ligne.version)
          } else {
            void charger()
          }
        },
      )
      .subscribe()

    return () => {
      void db.removeChannel(canal)
    }
  }, [roundId, charger, appliquerEtat])

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


  return { instantane, erreur, chargement, recharger: charger, appliquerEtat }
}
