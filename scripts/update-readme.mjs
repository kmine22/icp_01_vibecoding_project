import { readFileSync, writeFileSync } from 'node:fs';
import releases from '../dist/releases.js';

const { releaseHistory, unreleasedChanges } = releases;
const entries = [...releaseHistory].reverse();
if (unreleasedChanges.length) entries.unshift(['Unreleased', ...unreleasedChanges]);

const start = '<!-- BEGIN UPDATE HISTORY -->';
const end = '<!-- END UPDATE HISTORY -->';
const section = [
  start,
  '## Update history',
  ...entries.flatMap(([version, ...notes]) => [
    '',
    '### ' + version,
    '',
    ...notes.map((note) => '- ' + note),
  ]),
  end,
].join('\n');

const readme = new URL('../README.md', import.meta.url);
const current = readFileSync(readme, 'utf8');
const startOffset = current.indexOf(start);
const endOffset = current.indexOf(end);
if ((startOffset < 0) !== (endOffset < 0) || (startOffset >= 0 && endOffset < startOffset)) {
  throw new Error('README update history markers are mismatched.');
}

const next = startOffset < 0
  ? current.trimEnd() + '\n\n' + section + '\n'
  : current.slice(0, startOffset) + section + current.slice(endOffset + end.length);
if (process.argv.includes('--check')) {
  if (next !== current) {
    console.error('README update history is out of date. Run node scripts/update-readme.mjs.');
    process.exitCode = 1;
  }
} else if (next !== current) {
  writeFileSync(readme, next);
}
