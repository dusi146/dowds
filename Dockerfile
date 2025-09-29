# Image Node ổn định có apt
FROM node:20-bullseye

# Cài ffmpeg + yt-dlp
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3-pip \
 && pip3 install --no-cache-dir yt-dlp \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cài deps trước để cache
COPY package*.json ./
RUN npm install --omit=dev

# Copy source
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/server.js"]
