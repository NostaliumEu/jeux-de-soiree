import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { InvalidActionError } from '@/engine/types'
import { ForbiddenError, NotFoundError } from './store'

/** Traduit une exception métier en réponse HTTP, sans jamais fuiter de trace. */
export function fail(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: 'Requête malformée.' }, { status: 400 })
  }
  if (error instanceof InvalidActionError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403 })
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }

  console.error('[jeux-de-soiree]', error)
  return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 })
}
