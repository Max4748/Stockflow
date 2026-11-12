"use client";

import { PackageIcon, SearchIcon, UserIcon, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { ResultatsRecherche } from "@/app/gestion/recherche/route";
import { ECRANS_GESTION } from "@/components/navigation-admin";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { normaliser } from "@/lib/tri";
import { cn } from "@/lib/utils";

/**
 * Recherche globale de l'espace gestion : taper un nom d'écran, de vendeur ou
 * de produit, et y aller. Ouverte par Ctrl+K (⌘K sur Mac) ou par le bouton de
 * l'en-tête, qui est le SEUL accès sur téléphone, où il n'y a pas de clavier.
 *
 * Elle ne remplace pas la navigation, elle la court-circuite : aller à la
 * fiche d'un vendeur demandait d'ouvrir Vendeurs, de trouver la ligne, puis de
 * cliquer. Ici c'est trois lettres et Entrée.
 *
 * Les ÉCRANS sont filtrés sur place (la liste est celle de la barre latérale,
 * droits compris). Les VENDEURS et les PRODUITS sont cherchés en base, après
 * 200 ms sans frappe : assez court pour paraître immédiat, assez long pour ne
 * pas envoyer une requête par lettre.
 *
 * Clavier : flèches pour parcourir, Entrée pour ouvrir, Échap pour fermer. Le
 * focus reste dans le champ ; c'est `aria-activedescendant` qui dit au lecteur
 * d'écran quelle ligne est visée.
 */

type Ligne = {
  cle: string;
  href: string;
  libelle: string;
  detail?: string;
  icone: LucideIcon;
};
type Groupe = { titre: string; lignes: Ligne[] };

const VIDE: ResultatsRecherche = { vendeurs: [], produits: [] };

export function RechercheGlobale({ niveau }: { niveau: number }) {
  const router = useRouter();
  const idListe = useId();
  const [ouvert, setOuvert] = useState(false);
  const [texte, setTexte] = useState("");
  const [resultats, setResultats] = useState<ResultatsRecherche>(VIDE);
  const [enCours, setEnCours] = useState(false);
  const [vise, setVise] = useState(0);
  const liste = useRef<HTMLDivElement>(null);

  // Raccourci global. `preventDefault` : Ctrl+K est aussi la barre d'adresse
  // de certains navigateurs.
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOuvert((o) => !o);
      }
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, []);

  const recherche = texte.trim();

  useEffect(() => {
    if (!ouvert || recherche.length < 2) return;
    const abandon = new AbortController();
    const minuterie = setTimeout(async () => {
      setEnCours(true);
      try {
        const reponse = await fetch(
          `/gestion/recherche?q=${encodeURIComponent(recherche)}`,
          { signal: abandon.signal },
        );
        // Session expirée : la garde redirige vers la connexion, et ce n'est
        // plus du JSON. On n'affiche alors que les écrans.
        const json = reponse.headers
          .get("content-type")
          ?.includes("application/json");
        setResultats(reponse.ok && json ? await reponse.json() : VIDE);
      } catch {
        // Requête abandonnée par une frappe plus récente : rien à faire.
      } finally {
        if (!abandon.signal.aborted) setEnCours(false);
      }
    }, 200);
    return () => {
      clearTimeout(minuterie);
      abandon.abort();
    };
  }, [ouvert, recherche]);

  const groupes = useMemo<Groupe[]>(() => {
    const cherche = normaliser(recherche);
    const ecrans = ECRANS_GESTION.filter(
      (g) => niveau >= (g.niveauMinimum ?? 0),
    )
      .flatMap((g) => g.entrees)
      .filter((e) => !cherche || normaliser(e.libelle).includes(cherche))
      .map((e) => ({
        cle: `ecran-${e.href}`,
        href: e.href,
        libelle: e.libelle,
        icone: e.icone,
      }));
    // Sous deux lettres, la base n'a pas été interrogée : on n'affiche pas les
    // résultats d'une recherche précédente.
    const base = recherche.length < 2 ? VIDE : resultats;

    return [
      { titre: "Écrans", lignes: ecrans },
      {
        titre: "Vendeurs",
        lignes: base.vendeurs.map((v) => ({
          cle: `vendeur-${v.id}`,
          href: `/gestion/vendeurs/${v.id}`,
          libelle: v.nom,
          detail: v.actif ? undefined : "inactif",
          icone: UserIcon,
        })),
      },
      {
        titre: "Produits",
        lignes: base.produits.map((p) => ({
          cle: `produit-${p.id}`,
          // L'état du stock filtré sur ce produit : c'est là qu'on voit où il
          // est et combien il en reste.
          href: `/gestion/stock?q=${encodeURIComponent(p.nom)}`,
          libelle: p.nom,
          detail: p.modele,
          icone: PackageIcon,
        })),
      },
    ].filter((g) => g.lignes.length > 0);
  }, [recherche, resultats, niveau]);

  const lignes = groupes.flatMap((g) => g.lignes);
  // La liste change à chaque frappe : la ligne visée est bornée à ce qui existe.
  const index = Math.min(vise, Math.max(0, lignes.length - 1));

  function ouvrir(ligne: Ligne | undefined) {
    if (!ligne) return;
    setOuvert(false);
    router.push(ligne.href);
  }

  function changerOuverture(valeur: boolean) {
    setOuvert(valeur);
    // Chaque ouverture repart d'un champ vide : on vient chercher autre chose.
    if (!valeur) {
      setTexte("");
      setResultats(VIDE);
      setVise(0);
    }
  }

  function viser(n: number) {
    setVise(n);
    liste.current
      ?.querySelector(`[data-index="${n}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOuvert(true)}
        aria-label="Rechercher un écran, un vendeur ou un produit"
        className="text-muted-foreground size-10 justify-center gap-2 px-0 md:w-auto md:justify-start md:px-3"
      >
        <SearchIcon className="size-4" />
        <span className="max-md:hidden">Rechercher</span>
        {/* Le raccourci n'est annoncé qu'aux écrans qui ont un clavier. */}
        <kbd className="bg-muted text-muted-foreground ml-2 rounded px-1.5 py-0.5 font-sans text-[0.6875rem] font-medium max-lg:hidden">
          Ctrl K
        </kbd>
      </Button>

      <Dialog open={ouvert} onOpenChange={changerOuverture}>
        <DialogContent
          showCloseButton={false}
          // Ancrée en HAUT plutôt que centrée : la liste s'allonge et se
          // raccourcit à chaque frappe, et une boîte centrée sauterait.
          className="top-[12vh] max-h-[76dvh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        >
          <DialogTitle className="sr-only">Recherche</DialogTitle>
          <DialogDescription className="sr-only">
            Chercher un écran, un vendeur ou un produit. Flèches pour parcourir,
            Entrée pour ouvrir.
          </DialogDescription>

          <div className="flex items-center gap-2.5 border-b px-4">
            <SearchIcon className="text-muted-foreground size-4 shrink-0" />
            <input
              autoFocus
              type="text"
              role="combobox"
              aria-expanded
              aria-controls={idListe}
              aria-activedescendant={
                lignes[index] ? `${idListe}-${index}` : undefined
              }
              aria-label="Rechercher"
              placeholder="Un écran, un vendeur, un produit…"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="go"
              value={texte}
              onChange={(e) => {
                setTexte(e.target.value);
                setVise(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  viser(Math.min(index + 1, lignes.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  viser(Math.max(index - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  ouvrir(lignes[index]);
                }
              }}
              // 16 px : en dessous, Safari sur iPhone zoome sur le champ.
              className="placeholder:text-muted-foreground h-13 min-w-0 flex-1 bg-transparent text-base outline-none"
            />
          </div>

          <div
            ref={liste}
            id={idListe}
            role="listbox"
            aria-label="Résultats"
            className="max-h-[60dvh] overflow-y-auto p-2"
          >
            {lignes.length === 0 ? (
              <p className="text-muted-foreground px-3 py-8 text-center text-sm">
                {enCours ? "Recherche…" : "Rien ne correspond."}
              </p>
            ) : (
              groupes.map((groupe) => (
                <div key={groupe.titre} role="group" aria-label={groupe.titre}>
                  <p className="text-muted-foreground px-3 pt-2 pb-1 text-xs font-medium tracking-wide uppercase">
                    {groupe.titre}
                  </p>
                  {groupe.lignes.map((ligne) => {
                    const n = lignes.indexOf(ligne);
                    return (
                      <div
                        key={ligne.cle}
                        id={`${idListe}-${n}`}
                        data-index={n}
                        role="option"
                        aria-selected={n === index}
                        onPointerMove={() => n !== index && setVise(n)}
                        onClick={() => ouvrir(ligne)}
                        className={cn(
                          "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-3 text-sm",
                          n === index && "bg-primary/10 text-primary",
                        )}
                      >
                        <ligne.icone className="size-4 shrink-0 opacity-70" />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {ligne.libelle}
                        </span>
                        {ligne.detail && (
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {ligne.detail}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
