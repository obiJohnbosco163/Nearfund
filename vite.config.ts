import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  envPrefix: ['VITE_NEAR_CONTRACT_ID', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
  resolve: {
    alias: [{ find: /^buffer$/, replacement: 'buffer/' }],
  },
});
