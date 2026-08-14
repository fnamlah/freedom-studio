# Build context is the REPO ROOT, not hermes/. The worker imports the app's real
# redaction chokepoint (../src/lib/ai/redactor.ts) rather than vendoring a copy
# that could silently drift, so both trees must be present at build time.
FROM node:22-alpine AS build
WORKDIR /repo

COPY hermes/package.json hermes/package-lock.json* ./hermes/
RUN cd hermes && npm ci

# The shared field modules (src/lib/fields/*, src/lib/forms.ts) import zod.
# Node resolves a package from the IMPORTING FILE's directory upward, so files
# under /repo/src/ never reach /repo/hermes/node_modules — they need a
# node_modules on their own path. Locally the repo root has the app's; in this
# container the worker's is the only one, so link it to the root. Runtime is
# unaffected: dist/ lands beside /app/node_modules and resolves normally.
RUN ln -s hermes/node_modules node_modules

COPY src ./src
COPY hermes ./hermes
RUN cd hermes && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY hermes/package.json hermes/package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /repo/hermes/dist ./dist

# Not root: a worker holding the service-role key should own as little as possible.
USER node
EXPOSE 8080
CMD ["node", "dist/hermes/src/index.js"]
