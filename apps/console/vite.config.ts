import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5310,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3310' },
    fs: { allow: [path.resolve(root, '../..')] },
  },
  build: {
    outDir: path.resolve(root, '../../dist/console'),
    emptyOutDir: false,
    rolldownOptions: {
      preserveEntrySignatures: 'strict',
      input: { main: path.join(root, 'index.html'), runtime: path.join(root, 'src/runtime.ts') },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'runtime' ? 'runtime.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
