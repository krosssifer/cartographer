import { defineConfig } from 'vitest/config';

// Отдельный конфиг: тестам не нужны react/tailwind/singlefile-плагины сборки.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
  },
});
