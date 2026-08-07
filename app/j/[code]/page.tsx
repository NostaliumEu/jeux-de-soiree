import { Salon } from '@/ui/Salon'

export const dynamic = 'force-dynamic'

/**
 * Le lien d'invitation. L'ouvrir suffit : si le navigateur connaît déjà une
 * identité pour ce code, on retombe directement dans la partie en cours ;
 * sinon on demande un pseudo et un avatar.
 */
export default async function PageSoiree({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return <Salon code={code.toUpperCase()} />
}
