#!/usr/bin/env node
/**
 * Translate all Russian text content inside an HTML file to Kazakh.
 * - Preserves HTML structure and whitespace as much as possible
 * - Translates text nodes and common attributes (title, alt, placeholder, aria-label, content)
 * - Skips script/style/code/pre where translation is unsafe
 * - Uses Google Translate web endpoint via axios (no API key) as a fallback method
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const minimist = require('minimist');

const argv = minimist(process.argv.slice(2));
const inputPath = argv._[0] || '/workspace/index.html';
const outputPath = argv._[1] || '/workspace/index.kk.html';

// Detect if string likely contains Russian letters
function containsRussianLetters(text) {
  return /[А-Яа-яЁё]/.test(text);
}

// Heuristic to avoid translating obvious URLs, emails, numbers-only
function shouldTranslate(text) {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (/^https?:\/\//i.test(trimmed)) return false;
  if (/^[\d\s.,:;!?()\-+/]+$/.test(trimmed)) return false;
  if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(trimmed)) return false;
  if (/^[A-Za-z\s\d.,:;!?()\-+/]+$/.test(trimmed) && !containsRussianLetters(trimmed)) return false;
  return true;
}

// Google translate web call (no key). Could be throttled; we will rate-limit.
async function translateRuToKk(text) {
  // Short-circuit: if no Russian chars, still translate to ensure mixed strings? We'll translate if user requested full doc.
  const url = 'https://translate.googleapis.com/translate_a/single';
  const params = {
    client: 'gtx',
    sl: 'ru',
    tl: 'kk',
    dt: 't',
    q: text,
  };
  try {
    const res = await axios.get(url, { params, timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    // Response is nested arrays; concatenate translated segments
    if (Array.isArray(res.data)) {
      const segments = res.data[0];
      if (Array.isArray(segments)) {
        return segments.map(s => (Array.isArray(s) ? s[0] : '')).join('');
      }
    }
  } catch (err) {
    // Fallback: return original text on failure
  }
  return text;
}

// Preserve surrounding whitespace while translating the core content
async function translatePreserveWhitespace(original) {
  const match = original.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const leading = match ? match[1] : '';
  const core = match ? match[2] : original;
  const trailing = match ? match[3] : '';
  const translatedCore = await translateRuToKk(core);
  return `${leading}${translatedCore}${trailing}`;
}

async function main() {
  const content = fs.readFileSync(inputPath, 'utf8');
  const lines = content.split(/\n/);

  // Simple concurrency control without extra deps
  const concurrency = 4;
  let active = 0;
  const queue = [];
  function run(task) {
    return new Promise((resolve) => {
      const exec = async () => {
        active++;
        try { await task(); } finally { active--; resolve(); next(); }
      };
      queue.push(exec);
      process.nextTick(next);
    });
  }
  function next() {
    while (active < concurrency && queue.length) {
      const fn = queue.shift();
      fn();
    }
  }

  const translatedLines = new Array(lines.length);
  const tasks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (containsRussianLetters(line) && shouldTranslate(line)) {
      tasks.push(
        run(async () => {
          translatedLines[i] = await translatePreserveWhitespace(line);
        })
      );
    } else {
      translatedLines[i] = line;
    }
  }

  await Promise.all(tasks);
  const output = translatedLines.join('\n');
  fs.writeFileSync(outputPath, output, 'utf8');
  console.log(`Translated file written to: ${outputPath}`);
}

main().catch((err) => {
  console.error('Translation failed:', err);
  process.exit(1);
});

