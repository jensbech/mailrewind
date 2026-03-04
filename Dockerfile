FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src/ ./src/
COPY --from=client-build /app/client/dist ./client/dist
RUN chown -R node:node /app
USER node
EXPOSE 3001
CMD ["node", "src/server.js"]
