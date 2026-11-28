import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MG_DIR = path.join(ROOT, 'minigame');
const MAX_MAIN_BYTES = 4 * 1024 * 1024; // 4 MB WeChat main package hard limit

const FORBIDDEN = [
  { name: 'document.', re: /\bdocument\s*\./ },
  { name: 'window.', re: /\bwindow\s*\./ },
  { name: 'eval(', re: /\beval\s*\(/ },
  { name: 'new Function', re: /\bnew\s+Function\b/ }
];

let totalBytes = 0;
let jsFiles = 0;

/** @param {string} dir */
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    const stat = fs.statSync(full);
    totalBytes += stat.size;
    if (!entry.name.endsWith('.js')) continue;
    jsFiles++;

    const raw = fs.readFileSync(full, 'utf8');
    // Strip JSDoc / block & line comments before checking runtime imports and globals
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const rel = path.relative(ROOT, full);

    for (const rule of FORBIDDEN) {
      if (rule.re.test(src)) {
        throw new Error(`Forbidden global "${rule.name}" found in ${rel}`);
      }
    }

    // Verify every relative runtime ES import ends with explicit .js
    for (const m of src.matchAll(/\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"](\.[^'"]+)['"]/g)) {
      const spec = m[1];
      if (!spec.endsWith('.js')) {
        throw new Error(`Relative import missing .js extension in ${rel}: "${spec}"`);
      }
      const target = path.resolve(path.dirname(full), spec);
      if (!fs.existsSync(target)) {
        throw new Error(`Broken import target in ${rel}: "${spec}"`);
      }
    }
  }
}

walk(MG_DIR);

if (totalBytes > MAX_MAIN_BYTES) {
  throw new Error(`minigame/ size (${totalBytes} B) exceeds 4 MB WeChat limit`);
}

console.log(`L4 WX GATE PASSED: ${jsFiles} JS files, total main package = ${(totalBytes / 1024).toFixed(1)} KB (limit: 4096 KB)`);
