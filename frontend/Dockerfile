# Multi-stage: build the Vite bundle with Node, then serve it with nginx, which
# also reverse-proxies the two backends (single origin -> no CORS needed).

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Same-origin at runtime: the whole backend surface is proxied under /api by
# the gateway (nginx.conf / nginx.neon.conf), matching the Vercel single-origin
# deploy, so BASE is /api in every image build. The direct-dev workflow
# (Vite :5173) overrides VITE_API_BASE to a full backend URL instead.
ARG VITE_API_BASE=/api
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
