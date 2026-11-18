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
# gateway. VITE_NO_WORKER=1 (from .env.production) still applies: no scan UI.
ARG VITE_API_BASE=
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
