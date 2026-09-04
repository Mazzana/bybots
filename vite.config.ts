import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import packageJson from "./package.json";

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(packageJson.version) },
  plugins: [react(), VitePWA({
    registerType: "autoUpdate",
    includeAssets: ["favicon.svg", "icons/icon-192.png", "icons/icon-512.png"],
    manifest: {
      name: "ByBots",
      short_name: "ByBots",
      description: "An accessible client for orchestrating Hermes Bots.",
      theme_color: "#0b0f17",
      background_color: "#0b0f17",
      display: "standalone",
      start_url: "/",
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
      ]
    },
    workbox: {
      navigateFallback: "/index.html",
      runtimeCaching: [{
        urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
        handler: "NetworkOnly",
        method: "GET"
      }]
    }
  })],
  server: {
    host: "127.0.0.1",
    port: 5188,
    strictPort: true,
    watch: {
      ignored: ["**/test-results/**", "**/playwright-report/**", "**/output/**", "**/release/**", "**/landing/**"]
    },
    proxy: { "/api": "http://127.0.0.1:4179" }
  },
  build: {
    outDir: "dist",
    rollupOptions: { output: { manualChunks: { markdown: ["react-markdown", "remark-gfm"] } } }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"]
  }
});
