import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const source = new URL('../dist/', import.meta.url);
const template = readFileSync(new URL('index.html', source), 'utf8');
const entry = '<html lang="en">';
if (!template.includes(entry)) throw new Error('Missing the root tag for the Pages build.');

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const history = readme.match(/<!-- BEGIN UPDATE HISTORY -->([\s\S]+)<!-- END UPDATE HISTORY -->/)?.[1].trim();
if (!history) throw new Error('Run node scripts/update-readme.mjs before preparing GitHub Pages.');

const output = mkdtempSync(join(tmpdir(), 'study-planner-pages-'));
const html = template.replace(entry, '<html lang="en" data-link-previews="off">')
  .replace(/\b(src|href)="([\w.-]+\.(?:css|js))"/g, (_, attribute, name) => {
    const asset = readFileSync(new URL(name, source));
    const fingerprint = createHash('sha256').update(asset).digest('hex').slice(0, 12);
    writeFileSync(join(output, name), asset);
    return attribute + '="' + name + '?v=' + fingerprint + '"';
  });

writeFileSync(join(output, 'index.html'), html);
writeFileSync(join(output, '.nojekyll'), '\n');
writeFileSync(join(output, 'README.md'), [
  '# Study Planner for GitHub Pages',
  'This edition runs in your browser. Save links and upload images to add thumbnails to moodboard cards. Your planner data stays in the current browser.',
  'The Python edition and local setup instructions are on the `main` branch.',
  history,
].join('\n\n') + '\n');

console.log(output);
