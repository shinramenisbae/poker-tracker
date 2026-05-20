// One-shot helper: reads dry-run.json (produced by parse.js), pulls canonical
// player names from the tracker, and prints which aliases are already mapped
// vs which still need a value in aliases.json — with fuzzy-match suggestions.
//
// Usage:  npm run parse  (once, to produce dry-run.json)
//         node list-aliases.js
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { TRACKER_API_BASE } = process.env;
if (!TRACKER_API_BASE) { console.error('Missing TRACKER_API_BASE'); process.exit(1); }

const dryRun = JSON.parse(await fs.readFile(path.join(__dirname, 'dry-run.json'), 'utf8'));
const aliases = JSON.parse(await fs.readFile(path.join(__dirname, 'aliases.json'), 'utf8'));
delete aliases._comment;

const sessions = await (await fetch(`${TRACKER_API_BASE}/sessions`)).json();
const canonicalSet = new Set();
for (const s of sessions) for (const p of (s.players || [])) if (p.name) canonicalSet.add(p.name.trim());
// Also include any non-empty values already in aliases.json as canonical targets
for (const v of Object.values(aliases)) if (v && v.trim()) canonicalSet.add(v.trim());
// Exclude junk: single/double-character names and known non-player labels
const EXCLUDED_CANONICALS = new Set(['n', 'rake']);
const canonical = [...canonicalSet].filter((c) => c.length >= 3 && !EXCLUDED_CANONICALS.has(c.toLowerCase()));

// Collect every unique alias seen across all parsed Discord ledgers
const aliasSet = new Set();
for (const entry of dryRun) {
  for (const p of (entry.players || [])) {
    const a = (p.originalAlias || p.name || '').trim();
    if (a) aliasSet.add(a);
  }
}
const seenAliases = [...aliasSet].sort((a, b) => a.localeCompare(b));

// --- fuzzy matching ---
function normalize(s) {
  return s.toLowerCase().replace(/\d+/g, '').replace(/[\s_]+/g, '').trim();
}
function levenshtein(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}
function similarity(alias, candidate) {
  const a = normalize(alias);
  const c = normalize(candidate);
  if (!a || !c) return 0;
  if (a === c) return 1;
  if (a.includes(c) || c.includes(a)) {
    const ratio = Math.min(a.length, c.length) / Math.max(a.length, c.length);
    return 0.7 + ratio * 0.25;
  }
  const dist = levenshtein(a, c);
  return 1 - dist / Math.max(a.length, c.length);
}
function bestMatches(alias, k = 3) {
  return canonical
    .map((c) => ({ name: c, score: similarity(alias, c) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, k);
}

// --- classify each alias ---
const aliasLookupCI = new Map(Object.entries(aliases).map(([k, v]) => [k.toLowerCase(), v]));

const mapped = [];
const needsMapping = [];
for (const alias of seenAliases) {
  const existingValue = aliasLookupCI.get(alias.toLowerCase());
  if (existingValue && existingValue.trim()) {
    mapped.push({ alias, mapped_to: existingValue });
    continue;
  }
  const top = bestMatches(alias);
  needsMapping.push({ alias, suggestions: top });
}

// --- output ---
console.log(`\n=== Already mapped (${mapped.length}) ===`);
for (const m of mapped) console.log(`  "${m.alias}"  →  "${m.mapped_to}"`);

console.log(`\n=== Needs mapping (${needsMapping.length}) ===`);
console.log('Suggestions are best-effort fuzzy matches against the 57 canonical names in the tracker.');
console.log('Edit aliases.json to set the correct value (or a new name if none of the suggestions fit).\n');
const pad = Math.max(...needsMapping.map((n) => n.alias.length), 4);
for (const n of needsMapping) {
  const sugg = n.suggestions
    .filter((s) => s.score > 0.4)
    .map((s) => `${s.name} (${s.score.toFixed(2)})`)
    .join(', ') || '(no good match)';
  console.log(`  ${n.alias.padEnd(pad)}  →  ${sugg}`);
}

// Also write a JSON skeleton you can paste over aliases.json
const skeleton = { _comment: aliases._comment ?? '' };
for (const m of mapped) skeleton[m.alias] = m.mapped_to;
for (const n of needsMapping) {
  const top = n.suggestions[0];
  skeleton[n.alias] = top && top.score > 0.7 ? top.name : '';
}
await fs.writeFile(path.join(__dirname, 'aliases.suggested.json'), JSON.stringify(skeleton, null, 2));
console.log(`\nWrote aliases.suggested.json — pre-fills high-confidence matches (score > 0.7).`);
console.log(`Review it, then copy to aliases.json once you're happy.`);
