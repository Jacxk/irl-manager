FROM docker:28-cli AS cli
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tar && rm -rf /var/lib/apt/lists/*
COPY --from=cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=cli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins
WORKDIR /app
COPY installer/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
ENV INSTALLER_DATA_DIR=/var/lib/irl-installer
CMD ["npm", "run", "installer"]
