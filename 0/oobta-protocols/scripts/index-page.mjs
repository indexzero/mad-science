// One page that shows every generated diagram, heatmaps as small multiples.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INK, OUT, write } from './lib.mjs';

const files = readdirSync(OUT);
const inline = (f) => readFileSync(join(OUT, f), 'utf8');
const heatmaps = files.filter((f) => f.startsWith('heatmap.') && f.endsWith('.html')).sort();

write('index.html', `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>OOBTA diagrams</title>
<style>
  body { margin: 24px; background: ${INK.surface}; color: ${INK.primary};
         font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  body > h2 { font-size: 15px; color: ${INK.secondary}; margin: 32px 0 8px; }
  .multiples figure h2 { font-size: 15px !important; margin: 0 0 2px !important; }
  .multiples figure h3 { font-size: 12px !important; font-weight: 400 !important; color: ${INK.muted} !important; margin: 0 0 8px !important; }
  .multiples { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
  img, svg { max-width: 100%; height: auto; }
</style>
<h1>OOBTA diagrams</h1>
<h2>Lenses compared (parallel sets)</h2>
${files.includes('parallel-sets.svg') ? inline('parallel-sets.svg') : '<p>Not built.</p>'}
<h2>Facts ordered by each lens (heatmaps)</h2>
<div class="multiples">${heatmaps.map(inline).join('\n')}</div>
<h2>Sovereignty (offerings ↔ operators)</h2>
${files.includes('sovereignty.svg') ? '<img src="sovereignty.svg" alt="Sovereignty bipartite graph">' : '<p>Not built.</p>'}
</html>
`);
