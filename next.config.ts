import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  serverExternalPackages: ['whatsapp-web.js', 'puppeteer', 'qrcode'],
  outputFileTracingIncludes: {
    '/api/**': ['./.puppeteerrc.cjs', './node_modules/puppeteer/.local-browsers/**/*'],
  },
  // Pin the workspace root to this project. Without it, Next finds the stray
  // ~/package-lock.json and treats the whole home directory as the root.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
