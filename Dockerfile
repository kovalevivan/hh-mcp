FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc --noEmit && npm run build:bundle

FROM node:24-alpine
ENV NODE_ENV=production PORT=3400
WORKDIR /app
COPY --from=build --chown=node:node /app/dist/bundle.cjs ./bundle.cjs
USER node
EXPOSE 3400
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3400/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "bundle.cjs", "--http"]
