# Multi-stage: build the Vite bundle with Node, then serve it with nginx, which
# also reverse-proxies the two backends (single origin -> no CORS needed).

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Same-origin at runtime: BASE defaults to "" so the app calls the gateway with
# bare paths (/persons, /thumb/...), which nginx.conf proxies. Force
# VITE_API_BASE="" here because .env.production carries VITE_API_BASE=/api for
# the Vercel single-origin deploy only — that prefix 404s against this local
# gateway.
ARG VITE_API_BASE=
ENV VITE_API_BASE=$VITE_API_BASE
# Scan/Import UI visibility. Explicit flag so it is SHOWN on local worker-dev
# (default build: empty -> the app's NO_WORKER is false) and HIDDEN where there
# is no ML worker: the Neon override passes VITE_NO_WORKER=1, and Vercel's own
# build reads VITE_NO_WORKER=1 from .env.production. Set here so it overrides
# .env.production for the local image.
ARG VITE_NO_WORKER=
ENV VITE_NO_WORKER=$VITE_NO_WORKER
# Destructive curation (select/merge, hide person) visibility. Default empty ->
# shown on local desktop (hidden on mobile via the md breakpoint). Vercel reads
# VITE_READONLY=1 from .env.production to hide it everywhere (browse-only).
ARG VITE_READONLY=
ENV VITE_READONLY=$VITE_READONLY
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
