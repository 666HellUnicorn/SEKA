FROM node:24-slim

WORKDIR /app

ENV NODE_ENV=production
ENV SEKA_HOST=0.0.0.0
ENV SEKA_PORT=8765
ENV SEKA_DATA_DIR=/app/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY web ./web

EXPOSE 8765
VOLUME ["/app/data"]

CMD ["node", "src/server/server.ts"]
