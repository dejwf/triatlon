# Produkční image: `api` (NestJS) a `web` (statický web + reverzní proxy s HTTPS, Caddy).
#   docker build --target api -t triatlon-api .
#   docker build --target web -t triatlon-web .
# Viz deploy/README.md.

FROM node:24-alpine AS build
RUN npm install -g pnpm@12.16.1
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter '!@triatlon/mobile'
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
ARG VITE_ORGANIZER_NAME
ARG VITE_ORGANIZER_CONTACT
# prisma generate jen čte konfiguraci — k databázi se při buildu nepřipojuje.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm --filter @triatlon/shared build \
 && pnpm --filter @triatlon/api build \
 && pnpm --filter @triatlon/web build \
 && pnpm --filter @triatlon/api deploy --prod --legacy /out/api

FROM node:24-alpine AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/api .
USER node
EXPOSE 3000
# Migrace databáze při každém startu (idempotentní), pak server.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/main.js"]

FROM caddy:2.10-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
