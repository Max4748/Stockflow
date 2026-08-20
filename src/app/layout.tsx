import type { Metadata, Viewport } from "next";

import { FournisseurTheme } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

export const metadata: Metadata = {
  title: "StockFlow",
  description: "Gestion de stock, ventes et créances multi-vendeurs",
};

export const viewport: Viewport = {
  // L'espace vendeur est conçu pour le téléphone : la saisie de vente se fait
  // debout, pas assis devant un écran.
  width: "device-width",
  initialScale: 1,
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
      </body>
    </html>
  );
}
