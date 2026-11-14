FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS application
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]

FROM node:22-alpine AS firestore-emulator
RUN apk add --no-cache openjdk21-jre
RUN npm install --global firebase-tools@15.32.1
WORKDIR /emulator
COPY firebase.json firestore.indexes.json ./
ENV JAVA_TOOL_OPTIONS="-Xms256m -Xmx1g"
EXPOSE 8080
CMD ["firebase", "emulators:start", "--only", "firestore", "--project", "chat-backend-local", "--import", "/data", "--export-on-exit", "/data"]
