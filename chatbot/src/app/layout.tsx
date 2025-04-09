import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'BIAN AI Knowledge Assistant',
  description: 'Your intelligent assistant for Banking Industry Architecture Network standards and frameworks',
  icons: {
    icon: '/favicon.ico',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link rel="stylesheet" href="https://cdn.staticfile.org/font-awesome/6.4.0/css/all.min.css" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Noto+Serif:wght@400;500;600;700&display=swap" />
      </head>
      <body className="h-full font-sans antialiased">
        {children}
      </body>
    </html>
  )
}
