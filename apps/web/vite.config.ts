import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const appRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@freecell/contracts': path.resolve(appRoot, '../../packages/contracts/src/index.ts'),
      '@freecell/design-tokens': path.resolve(appRoot, '../../packages/design_tokens/src/index.ts'),
      '@freecell/design-tokens/css': path.resolve(
        appRoot,
        '../../packages/design_tokens/src/tokens.css',
      ),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 4173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
});
