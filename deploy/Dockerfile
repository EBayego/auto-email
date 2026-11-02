# syntax=docker/dockerfile:1
FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS node
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1

FROM node AS dependencies
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
COPY tsconfig.json next.config.ts ./
COPY src ./src
COPY scripts ./scripts
COPY google/project.json ./google/project.json
COPY public ./public
ENV APP_ENV=production
RUN npm run build

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node AS app
RUN groupadd --gid 10001 autoemail && useradd --uid 10001 --gid 10001 --no-create-home autoemail
COPY --from=build --chown=10001:10001 /app/.next/standalone ./
COPY --from=production-dependencies --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/.next/static ./.next/static
COPY --chown=10001:10001 public ./public
COPY --chown=10001:10001 src ./src
COPY --chown=10001:10001 scripts ./scripts
COPY --chown=10001:10001 google/project.json ./google/project.json
COPY --chown=10001:10001 deploy/*.mjs ./deploy/
COPY --chown=10001:10001 tsconfig.json package.json ./
USER 10001:10001
ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["node", "deploy/entrypoint.mjs"]
CMD ["web"]

FROM restic/restic:0.19.1@sha256:136600b6ff6843d61d355f7f71f460a166429f35de6fd11b568fece3c9a4d510 AS restic
FROM postgres:17-bookworm@sha256:839fbb5a4942a7758dd93e18b42ea5649807491a0545b5eeeb8f0b8bb11857a5 AS operations
WORKDIR /app
RUN groupadd --gid 10001 autoemail && useradd --uid 10001 --gid 10001 --no-create-home autoemail
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=restic /usr/bin/restic /usr/bin/restic
COPY --from=dependencies --chown=10001:10001 /app/node_modules ./node_modules
COPY --chown=10001:10001 src ./src
COPY --chown=10001:10001 scripts ./scripts
COPY --chown=10001:10001 deploy/*.mjs ./deploy/
COPY --chown=10001:10001 supabase/migrations ./supabase/migrations
COPY --chown=10001:10001 supabase/project.json ./supabase/project.json
COPY --chown=10001:10001 google/project.json ./google/project.json
COPY --chown=10001:10001 supabase/config.toml ./supabase/config.toml
COPY --chown=10001:10001 tsconfig.json package.json ./
USER 10001:10001
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1
ENTRYPOINT ["node", "deploy/entrypoint.mjs"]
CMD ["preflight"]
