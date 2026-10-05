import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  splitting: false,
  // @rrpp/shared exporta TypeScript sin compilar: se mete en el bundle
  noExternal: ['@rrpp/shared'],
});
