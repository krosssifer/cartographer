import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  // Редакторы и агенты пишут файлы через временные каталоги рядом с оригиналом.
  // Без игнора chokidar на Windows пытается взять их под наблюдение и падает с EBUSY.
  server: {
    watch: {
      ignored: ['**/node_modules/**', '**/.git/**', '**/*.tmpdir/**', '**/*.tmp'],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
