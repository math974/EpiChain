# =============================================================================
# Shared dependencies (used by development and production-build)
# =============================================================================
FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --legacy-peer-deps

# =============================================================================
# Development: Vite + nodemon (hot reload). Use: docker compose (target below).
# =============================================================================
FROM deps AS development

COPY docker-entrypoint-dev.sh /usr/local/bin/docker-entrypoint-dev.sh
RUN chmod +x /usr/local/bin/docker-entrypoint-dev.sh

COPY . .

EXPOSE 5173

ENTRYPOINT ["/usr/local/bin/docker-entrypoint-dev.sh"]
CMD ["npm", "run", "dev:docker"]

# =============================================================================
# Production: Vite build → nginx static (default `docker build` final stage)
# =============================================================================
FROM deps AS production-build

COPY . .

ARG VITE_WALLETCONNECT_PROJECT_ID
ENV VITE_WALLETCONNECT_PROJECT_ID=${VITE_WALLETCONNECT_PROJECT_ID}

RUN npm run build

FROM nginx:1.27-alpine AS production

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=production-build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
