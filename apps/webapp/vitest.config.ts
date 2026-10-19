import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // CI excludes known-failing files by name via VITEST_EXCLUDE (comma
    // separated); see .github/workflows/webapp.yml. Unset locally.
    exclude: [
      ...configDefaults.exclude,
      ...(process.env.VITEST_EXCLUDE?.split(',').filter(Boolean) ?? []),
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
