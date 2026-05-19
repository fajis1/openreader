FROM node:lts

RUN npm install -g pnpm@11.1.2

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY compute/worker/package.json compute/worker/package.json
COPY compute/core/package.json compute/core/package.json

RUN pnpm install --frozen-lockfile

COPY . .

ENV COMPUTE_WORKER_HOST=0.0.0.0
ENV COMPUTE_WORKER_PORT=8081

EXPOSE 8081

CMD ["pnpm", "--filter", "@openreader/compute-worker", "dev"]
