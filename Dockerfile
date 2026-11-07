FROM node:22-bookworm-slim AS development
WORKDIR /app
ENV NODE_ENV=development HOSTNAME=0.0.0.0
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
ARG MOBLIN_GATEWAY_URL=http://moblin:3001
ENV MOBLIN_GATEWAY_URL=${MOBLIN_GATEWAY_URL}
COPY . .
RUN npm run build
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
