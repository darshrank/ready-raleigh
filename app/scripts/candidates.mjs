// Builds the mayoral candidate portraits (DESIGN.md: printed spot inks) from the Open Peeps
// bust templates (CC0, Pablo Stanley, https://www.openpeeps.com). The 2-colour art is recoloured
// with the design tokens, so it only works inline (CSS variables): black -> --ink, white -> --bond.
// Usage: node app/scripts/candidates.mjs "<path to Open Peeps Flat Assets/Templates/Bust>"
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Hand-picked busts that read as candidates on a campaign card (varied people, no props that
// distract). Order = the order shown in the picker. Keep in sync with shared/src/candidates.ts.
export const PICKS = [17, 52, 34, 92, 6, 96, 4, 8, 18, 23, 38, 46, 49, 76, 83, 98];

const src = process.argv[2];
if (!src) throw new Error('Pass the path to the Open Peeps Templates/Bust folder');
const out = new URL('../public/candidates/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

for (const n of PICKS) {
  const svg = readFileSync(join(src, `peep-${n}.svg`), 'utf8')
    .replace(/<\?xml[^>]*>\s*/, '')
    .replace(/<!--.*?-->\s*/gs, '')
    .replace(/<title>.*?<\/title>\s*|<desc>.*?<\/desc>\s*/gs, '')
    .replace(/<svg [^>]*viewBox="([^"]+)"[^>]*>/, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="$1" aria-hidden="true">')
    .replace(/fill="#(000000|221E1F|4F66AF)"/gi, 'style="fill:var(--ink)"')
    .replace(/fill="#FFFFFF"/gi, 'style="fill:var(--bond)"')
    .replace(/\s{2,}/g, ' ');
  if (/#[0-9a-f]{6}/i.test(svg)) throw new Error(`peep-${n}: an unmapped colour is left`);
  writeFileSync(join(out, `peep-${n}.svg`), svg);
}
writeFileSync(join(out, 'LICENSE.md'), '# Candidate portraits\n\nOpen Peeps by Pablo Stanley (https://www.openpeeps.com), CC0 1.0 (public domain).\nRecoloured with the design tokens by `app/scripts/candidates.mjs`.\n');
console.log(`${PICKS.length} candidates written to ${out}`);
