import { defineConfig } from 'vite';

// Relative base so the build works unmodified on GitHub Pages regardless of
// whether it's served from a user/org root or a project subpath
// (https://<user>.github.io/<repo>/), and also works via `vite preview`.
export default defineConfig({
  base: '/cat/',
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/phaser')) {
            return 'phaser';
          }
        },
      },
    },
  },
  server: {
    host: true,
  },
});


