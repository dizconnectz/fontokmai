import { type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const examples = fileURLToPath(new URL('../../contracts/v1/examples/', import.meta.url));
// Serve and bundle the producer's fixtures without maintaining a second copy.
function contractExamples(): Plugin {
  const assets = new Map<string, Buffer>();
  for (const scenario of readdirSync(examples)) {
    for (const file of ['manifest.json', 'alerts.json']) {
      assets.set(`examples/${scenario}/${file}`, readFileSync(`${examples}/${scenario}/${file}`));
    }
  }
  for (const file of ['LICENSE', 'NOTICE']) {
    assets.set(file, readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url))));
  }
  assets.set(
    'fonts/noto-sans-thai-400.woff2',
    readFileSync(
      fileURLToPath(
        new URL(
          './node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff2',
          import.meta.url,
        ),
      ),
    ),
  );
  assets.set(
    'FONT-LICENSE.txt',
    readFileSync(
      fileURLToPath(new URL('./node_modules/@fontsource/noto-sans-thai/LICENSE', import.meta.url)),
    ),
  );
  return {
    name: 'contract-examples',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0].replace(/^\//, '');
        const body = assets.get(path);
        if (!body) return next();
        res.setHeader(
          'Content-Type',
          path.endsWith('.json')
            ? 'application/json'
            : path.endsWith('.woff2')
              ? 'font/woff2'
              : 'text/plain; charset=utf-8',
        );
        res.setHeader('Cache-Control', 'no-store');
        res.end(body);
      });
    },
    generateBundle() {
      for (const [fileName, source] of assets) this.emitFile({ type: 'asset', fileName, source });
    },
  };
}

export default defineConfig({
  plugins: [react(), contractExamples()],
  test: { include: ['src/**/*.test.ts'] },
});
