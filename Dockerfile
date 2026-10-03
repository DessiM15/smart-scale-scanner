# The scan service: Node 22 and Chromium on a small Debian image.
#
#   docker build -t ssa-service .
#   docker run -p 8080:8080 -e SSA_WORKER_SECRET=... -e SSA_CALLBACK_HOST=smartscaleagent.com ssa-service
#
# Chrome runs as an unprivileged user with its sandbox on. If the host does
# not allow unprivileged user namespaces, Chrome will not start; set
# SSA_NO_SANDBOX=1 in that environment and note it in the deploy log.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-core \
    fonts-noto-color-emoji \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV SSA_CHROME=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=8080

RUN useradd --create-home --shell /usr/sbin/nologin scanner
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY bin ./bin

USER scanner
EXPOSE 8080
CMD ["node", "src/server.ts"]
