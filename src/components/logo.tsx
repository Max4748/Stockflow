import { cn } from "@/lib/utils";

/**
 * Marque de l'application : le carton et la flèche de `scripts/icon-source.svg`
 * (l'icône installée sur l'écran d'accueil), posés sur un carré à la couleur
 * primaire. Un même dessin partout, de l'icône du téléphone à l'en-tête.
 *
 * `aria-hidden` : le nom « StockFlow » est toujours écrit à côté, ou porté par
 * le lien qui contient la marque.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-primary text-primary-foreground inline-flex size-8 shrink-0 items-center justify-center rounded-lg shadow-xs",
        className,
      )}
    >
      <svg viewBox="70 120 370 290" className="size-[62%]" fill="none">
        <g
          stroke="currentColor"
          strokeWidth="30"
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          <path d="M104 214h180v170H104z" />
          <path d="M104 214 152 150h84l48 64" />
          <path d="M194 150v64" />
          <g opacity="0.7">
            <path d="M316 306h74" />
            <path d="M356 262l52 44-52 44" />
          </g>
        </g>
      </svg>
    </span>
  );
}
