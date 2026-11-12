import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Silhouette d'un écran pendant que ses données arrivent.
 *
 * Toutes les pages sont `force-dynamic` et lisent la base à chaque visite :
 * sans ceci, un clic dans la navigation ne produisait RIEN à l'écran jusqu'à
 * la réponse du serveur, et sur un téléphone en 4G on ne savait pas si le
 * clic avait été pris. Les fichiers `loading.tsx` montrent cette silhouette
 * tout de suite ; l'en-tête et la navigation, eux, ne bougent pas.
 *
 * La silhouette reprend la FORME de l'écran attendu (indicateurs, tableau ou
 * tuiles) aux mêmes paliers de colonnes que les vraies pages : c'est ce qui
 * évite le saut de mise en page à l'arrivée des données.
 *
 * `aria-busy` + un texte masqué : un lecteur d'écran annonce « Chargement »,
 * au lieu de lire une suite de blocs vides.
 */
export function SquelettePage({
  indicateurs = 4,
  forme = "tableau",
  actions = 1,
}: {
  /** Nombre de cartes d'indicateur ; 0 pour n'en montrer aucune. */
  indicateurs?: number;
  forme?: "tableau" | "tuiles";
  /** Nombre de boutons dans l'en-tête. */
  actions?: number;
}) {
  return (
    <div className="w-full space-y-6" aria-busy="true">
      <span className="sr-only" role="status">
        Chargement…
      </span>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <Skeleton className="h-8 w-48" />
        <div className="flex flex-col gap-2 sm:flex-row">
          {Array.from({ length: actions }, (_, i) => (
            <Skeleton key={i} className="h-11 w-full sm:h-10 sm:w-40" />
          ))}
        </div>
      </div>

      {indicateurs > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: indicateurs }, (_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-3 w-40 max-w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {forme === "tuiles" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
          {Array.from({ length: 8 }, (_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-8 w-12" />
                <Skeleton className="h-3 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <Skeleton className="h-4 w-40" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
