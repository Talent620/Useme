# syntax=docker/dockerfile:1
FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY packages/core/package.json packages/core/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile || pnpm install
COPY . .
RUN pnpm --filter @radar/worker exec prisma generate || true
# Node 22 runs .ts directly via native type stripping.
CMD ["node", "apps/worker/src/index.ts"]
