# Image de production de StockFlow, pour l'auto-hébergement.
# Mise en service et exploitation : docs/exploitation.md
#
# CE QUE CETTE IMAGE NE CONTIENT PAS : aucun secret, dans aucune couche.
# StockFlow n'a aucune variable NEXT_PUBLIC_*, donc rien à inliner dans un
# bundle au moment du build. Les trois variables sont lues À L'EXÉCUTION
# (src/lib/env.ts) et fournies par Compose. C'est le dividende direct du choix
# « aucun accès Supabase depuis le navigateur » : changer SUPABASE_URL le jour
# d'une exposition publique ne demandera aucun rebuild.
#
# (Une application qui expose des NEXT_PUBLIC_* doit, elle, les passer en
# build-args : Next les grave dans le bundle à la compilation.)

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# VALEURS FACTICES, ET SEULEMENT POUR CETTE ÉTAPE.
#
# `src/lib/env.ts` valide les variables AU CHARGEMENT du module et lève si
# l'une manque. Or `next build` évalue le module de chaque page pendant sa
# phase « collect page data » — y compris celles marquées `force-dynamic`, qui
# ne seront pourtant jamais prérendues. Sans ces valeurs, le build s'arrête :
#
#   Error: Failed to collect page data for /changer-mot-de-passe
#     [cause]: Variable d'environnement manquante : SUPABASE_URL.
#
# (Vérifié en retirant ces trois lignes : le build échoue bien ainsi.)
#
# Elles ne franchissent pas la frontière d'étape : le `runner` ci-dessous
# repart d'un FROM neuf. Rien de ceci n'existe dans l'image finale, et aucune
# de ces valeurs n'est un secret de toute façon.
ENV SUPABASE_URL=http://placeholder.invalid \
    SUPABASE_ANON_KEY=valeur-de-build \
    SUPABASE_SERVICE_ROLE_KEY=valeur-de-build

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Utilisateur non privilégié : un serveur exposé, même en loopback, n'a aucune
# raison de tourner en root dans son conteneur.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Sortie « standalone » : server.js, les node_modules réellement atteints et les
# assets — pas le code source, pas les migrations, pas les scripts.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
ENV PORT=3000
# 0.0.0.0 DANS le conteneur, ce qui n'expose rien : c'est Compose qui publie le
# port, et il le lie à 127.0.0.1 côté hôte.
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
