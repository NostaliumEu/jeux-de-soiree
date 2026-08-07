import type { Metadata, Viewport } from 'next'
import { Bricolage_Grotesque, Chivo, Azeret_Mono } from 'next/font/google'
import './globals.css'

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['700', '800'],
  variable: '--police-display',
  display: 'swap',
})

const corps = Chivo({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--police-corps',
  display: 'swap',
})

const mono = Azeret_Mono({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--police-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Jeux de soirée',
  description:
    'Des mini-jeux à boire en multijoueur. On rejoint par un lien, on joue sur son téléphone.',
}

export const viewport: Viewport = {
  themeColor: '#07040d',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${display.variable} ${corps.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
