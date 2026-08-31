import type { Metadata, Viewport } from "next";

import { EnregistrerServiceWorker } from "@/components/enregistrer-service-worker";
import { FournisseurTheme } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

export const metadata: Metadata = {
  title: "StockFlow",
  description: "Gestion de stock, ventes et créances multi-vendeurs",
  // Le manifeste est servi par src/app/manifest.ts ; Next pose lui-même le
  // <link rel="manifest">. Les icônes sont déclarées ici parce que iOS ignore
  // le manifeste et ne lit que <link rel="apple-touch-icon">.
  icons: {
    icon: [{ url: "/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "StockFlow", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  // L'espace vendeur est conçu pour le téléphone : la saisie de vente se fait
  // debout, pas assis devant un écran.
  width: "device-width",
  initialScale: 1,
  // Deux valeurs, pas une : installée, l'application n'a plus de barre d'URL,
  // et c'est cette couleur qui peint la zone système. Une seule valeur ferait
  // un bandeau clair au-dessus d'une interface sombre, ou l'inverse.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1b1b" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-dvh antialiased">
        {/* Le Toaster est DANS le fournisseur : sonner lit useTheme() pour
            accorder ses notifications au thème courant. */}
        <FournisseurTheme>
          {children}
          <Toaster position="top-center" />
        </FournisseurTheme>
        <EnregistrerServiceWorker />
      </body>
    </html>
  );
}
