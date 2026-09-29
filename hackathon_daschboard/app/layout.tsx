import type {Metadata} from 'next';
import './globals.css'; // Global styles

export const metadata: Metadata = {
  title: 'TARCZA - System Wczesnego Ostrzegania i Zarządzania Kryzysowego',
  description: 'Zintegrowana platforma dowodzenia KDR dual-use: wczesne ostrzeganie OSINT, nadzór nad rojem dronów, automatyczna detekcja zagrożeń, procedura Hot-Swap oraz asystent ewakuacji.',
  openGraph: {
    title: 'TARCZA - System Wczesnego Ostrzegania i Zarządzania Kryzysowego',
    description: 'Zintegrowana platforma dowodzenia KDR dual-use: wczesne ostrzeganie OSINT, nadzór nad rojem dronów, automatyczna detekcja zagrożeń, procedura Hot-Swap oraz asystent ewakuacji.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TARCZA - System Wczesnego Ostrzegania i Zarządzania Kryzysowego',
    description: 'Zintegrowana platforma dowodzenia KDR dual-use: wczesne ostrzeganie OSINT, nadzór nad rojem dronów, automatyczna detekcja zagrożeń, procedura Hot-Swap oraz asystent ewakuacji.',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
