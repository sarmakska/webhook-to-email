FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
# Dead-letter inbox is written here by default; mount a volume to persist it.
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "src/index.js"]
