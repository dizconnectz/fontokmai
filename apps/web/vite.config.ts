import { type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const examples = fileURLToPath(new URL('../../contracts/v1/examples/', import.meta.url));
// Keep the application's licence visible in distributed chunks, including AI-assisted copies.
// This notice does not change the licences of bundled third-party modules.
const usageNotice = `/*! fontokmai application code: PolyForm-Noncommercial-1.0.0.
 * Required Notice: Copyright (c) 2026 fontokmai by Takuma (https://dizconnectz.github.io/fontokmai/)
 * Automated/AI-assisted reuse: see LICENSE, NOTICE and AI_USAGE.md at https://github.com/dizconnectz/fontokmai.
 * Bundled third-party modules retain their own licences; see THIRD-PARTY-NOTICES.txt.
 */`;
// Serve and bundle the producer's fixtures without maintaining a second copy.
function contractExamples(): Plugin {
  const assets = new Map<string, Buffer>();
  // every producer file of every example (snapshots have manifest/alerts; ref examples have their own file)
  for (const scenario of readdirSync(examples)) {
    for (const file of readdirSync(`${examples}/${scenario}`)) {
      if (!file.endsWith('.json') || file === 'expected.json') continue;
      assets.set(`examples/${scenario}/${file}`, readFileSync(`${examples}/${scenario}/${file}`));
    }
  }
  for (const file of ['LICENSE', 'NOTICE', 'AI_USAGE.md']) {
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
  // GitHub Pages serves the site under /fontokmai/; local dev, preview and tests stay at /
  base: process.env.WEB_BASE ?? '/',
  plugins: [react(), contractExamples()],
  build: { rolldownOptions: { output: { postBanner: usageNotice } } },
  test: { include: ['src/**/*.test.ts'] },
});
