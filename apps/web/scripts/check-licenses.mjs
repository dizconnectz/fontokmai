import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
const allowed = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '(MIT OR Apache-2.0)',
]);
const notices = [
  'fontokmai — third-party software and font notices\nThese components retain their original licenses.\n',
];
const failures = [];
let checked = 0;
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path) continue;
  const font = path === 'node_modules/@fontsource/noto-sans-thai' && entry.license === 'OFL-1.1';
  // MPL tools are not shipped to the browser; their source files remain unmodified.
  const mplTool =
    entry.dev &&
    entry.license === 'MPL-2.0' &&
    /^node_modules\/(?:@axe-core\/playwright|axe-core|lightningcss(?:-[a-z0-9-]+)?)$/.test(path);
  if (!allowed.has(entry.license) && !font && !mplTool)
    failures.push(`${path}: unreviewed license ${entry.license}`);
  checked++;
  if (entry.dev || !existsSync(resolve(root, path))) continue;
  const files = readdirSync(resolve(root, path)).filter((file) =>
    /^(licen[cs]e|copying|notice)(\.|$)/i.test(file),
  );
  if (!files.length && path === 'node_modules/murmurhash-js') {
    const readme = readFileSync(resolve(root, path, 'README.md'), 'utf8');
    const section = readme.indexOf('## License (MIT)');
    if (section >= 0) {
      notices.push(`\n${path} ${entry.version}\n${readme.slice(section)}`);
      continue;
    }
  }
  if (!files.length) failures.push(`${path}: no license text found for bundled dependency`);
  notices.push(`\n${path.replace('node_modules/', '')} ${entry.version} — ${entry.license}\n`);
  for (const file of files) notices.push(readFileSync(resolve(root, path, file), 'utf8'));
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
if (process.argv.includes('--write'))
  writeFileSync(resolve(root, 'public/THIRD-PARTY-NOTICES.txt'), notices.join('\n'));
console.log(
  `Dependency licenses: ${checked} checked; no GPL family; OFL font and dev-only MPL tools documented.`,
);
