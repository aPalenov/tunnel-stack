# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app

# Install deps separately for caching
COPY package.json ./
RUN npm install --production && npm cache clean --force

# Copy source
COPY src ./src
RUN mkdir -p ./data

# Data directory is now provided via a bind mount (see docker-compose).
# We don't bake the runtime db.json into the image so edits persist on host
# and image rebuilds aren't triggered by data changes.

ENV PORT=3000
ENV DB_FILE=/app/data/db.json
EXPOSE 3000

CMD ["npm", "start"]
