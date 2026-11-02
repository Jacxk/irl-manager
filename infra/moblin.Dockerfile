FROM node:22-bookworm-slim
WORKDIR /app
COPY moblin/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY tsconfig.json ./
COPY src/lib ./src/lib
COPY moblin ./moblin
ENV MOBLIN_BIND=0.0.0.0
USER node
EXPOSE 3001
CMD ["npm", "run", "moblin"]
