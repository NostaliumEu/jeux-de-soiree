'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Client du navigateur. Il ne dispose que de la clé publiable : RLS l'empêche
 * d'écrire quoi que ce soit, et lui interdit purement et simplement l'état
 * secret des manches. Il ne sert qu'à lire et à s'abonner au temps réel.
 */

let cache: SupabaseClient | null = null

export function browserClient(): SupabaseClient {
  if (cache) return cache

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error(
      'Configuration Supabase absente : renseigne NEXT_PUBLIC_SUPABASE_URL et ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY (voir .env.example).',
    )
  }

  cache = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 20 } },
  })
  return cache
}
