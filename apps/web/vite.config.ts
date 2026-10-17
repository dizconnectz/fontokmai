import { type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
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

// GitHub Pages cannot send response headers (public/_headers is ignored there), so the page carries its own
// Content-Security-Policy as a <meta>. It is added to the built page only: the dev server needs inline scripts for
// hot reload. Inline scripts are allowed by hash, so nothing injected into the page can run. A new host the page
// talks to (a different DATA_BASE_URL, another basemap) must be added here, or the browser blocks it.
function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const hashes = [
          ...html.matchAll(
            /<script(?![^>]*\b(?:src\b|type="application\/ld\+json"))[^>]*>([\s\S]*?)<\/script>/g,
          ),
        ].map((match) => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
        const policy = [
          "default-src 'self'",
          `script-src 'self' 'unsafe-eval' ${hashes.join(' ')}`, // 'unsafe-eval': Ajv builds its checkers with new Function
          "style-src 'self' 'unsafe-inline'", // MapLibre sets style attributes on its markers and controls
          "img-src 'self' data: blob: https://dizconnectz.github.io https://tiles.openfreemap.org",
          "font-src 'self' data: https://tiles.openfreemap.org",
          "connect-src 'self' https://dizconnectz.github.io https://tiles.openfreemap.org https://photon.komoot.io",
          "worker-src 'self' blob:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; ');
        return [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  };
}

export default defineConfig({
  // GitHub Pages serves the site under /fontokmai/; local dev, preview and tests stay at /
  base: process.env.WEB_BASE ?? '/',
  plugins: [react(), contractExamples(), contentSecurityPolicy()],
  build: { rolldownOptions: { output: { postBanner: usageNotice } } },
  test: { include: ['src/**/*.test.ts'] },
});
