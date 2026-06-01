# ---- Base image: Node 20 on Debian (so apt chromium is available) ----
FROM node:20-bookworm-slim

# Install system Chromium + the fonts/libs WhatsApp Web needs to render.
# We use the OS chromium instead of puppeteer's bundled one (smaller image,
# more reliable on servers).
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Tell puppeteer NOT to download its own Chromium and use the system one.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install dependencies first (better build caching).
# devDependencies are needed for `next build`, so we do NOT set NODE_ENV=production here.
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build.
COPY . .
RUN npx prisma generate && npm run build

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

EXPOSE 3000

# Entrypoint applies the DB schema to the persistent volume, then starts Next.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "start"]
