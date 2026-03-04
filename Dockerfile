FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM node:22-alpine AS server-deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

FROM node:22-alpine
WORKDIR /app
COPY --from=server-deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src/ ./src/
COPY --from=client-build /app/client/dist ./client/dist
RUN chown -R node:node /app
USER node
EXPOSE 3001
CMD ["node", "src/server.js"]
