import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Les PORT fra .env (Vite legger ikke .env i process.env for config) så proxyen treffer samme port som backenden
  const env = loadEnv(mode, process.cwd(), '');
  const port = env.PORT ?? process.env.PORT ?? '3001';
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': `http://localhost:${port}`,
      },
      // design-sync-bygg skal ikke trigge reload i appen
      watch: { ignored: ['**/ds-bundle/**', '**/.ds-sync/**', '**/.design-sync/**'] },
    },
  };
});
