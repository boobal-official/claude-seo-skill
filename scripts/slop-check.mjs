#!/usr/bin/env node
// Usage: node slop-check.mjs <file...> [--json]
// Flags generic AI-writing patterns in Markdown/MDX/HTML/TSX copy (skips BOM, frontmatter, fenced
// code and inline code). Every hit is a prompt to rewrite with a concrete fact, not an automatic
// error: a word used in its literal technical sense can stay (say why in the report).
// Exit: 1 = hits remain, 0 = none, 64 = usage error, 3 = internal error. --json output is always JSON.

import { readFileSync } from 'node:fs';
import { parseArgs, runMain, UsageError } from './lib.mjs';

const RULES = [
  // Dashes between words only; number ranges ("3–5", "2024–2026") are fine.
  ['dash', /(?<!\d\s?)[—–]|[—–](?!\s?\d)/, 'em/en dash between words: use a period, comma or colon'],
  ['contrast-frame', /\bnot (just|only|merely) [^.]{1,60}?\b(but|it'?s)\b|\bit'?s not [^.,]{1,40}, it'?s\b/i, '"not X, but Y" frame: state Y directly'],
  ['ai-vocab', /\b(delve\w*|tapestry|testament to|underscor\w*|foster\w*|garner\w*|interplay|intricate|pivotal|vibrant|showcas\w*|realm|embark\w*|navigat(e|ing) the (complex|ever)|ever-evolving|in today'?s (fast-paced|digital)|unlock(ing)? the (power|potential))\b/i, 'AI vocabulary: use the plain word'],
  ['puffery', /\b(groundbreaking|game-chang\w*|revolutioni[sz]\w*|seamless\w*|blazing(ly)?[- ]fast|world-class|cutting-edge|next-gen\w*|best-in-class|state-of-the-art|unparalleled|effortless\w*)\b/i, 'puffery: replace with the number or mechanism'],
  ['pompous', /\b(utiliz\w*|leverag\w*|facilitat\w*|commenc\w*|in order to|due to the fact that|in the event that|serves as|stands as|boasts)\b/i, 'pompous phrasing: use/help/start/to/because/if/is/has'],
  ['vague-source', /\b(experts (believe|say|agree)|studies (show|suggest)|industry reports|research shows|many (teams|people|users) (find|say))\b/i, 'unsourced authority: cite the source or state the fact'],
  ['filler-adverb', /\b(significantly|dramatically|incredibly|extremely|truly|easily|simply)\b/i, 'filler adverb: give the delta instead'],
  ['transition', /^\s*(moreover|furthermore|additionally|in conclusion|ultimately|overall),/im, 'formulaic transition'],
  ['chatbot', /\b(in this (article|guide|post),? (we|you)('ll| will)|let'?s dive|dive (in|into)|i hope this helps|as we have seen|without further ado)\b/i, 'chatbot artifact: cut it'],
];

const args = parseArgs(process.argv.slice(2));
runMain(async () => {
  if (!args._.length) throw new UsageError('no files given');
  const hits = [];
  for (const f of args._) {
    let text;
    try { text = readFileSync(f, 'utf8').replace(/^﻿/, ''); } catch (e) { throw new UsageError(`cannot read ${f}: ${e.code || e.message}`); }
    const fm = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
    const offsetLines = fm ? fm[0].split('\n').length - 1 : 0;
    if (fm) text = text.slice(fm[0].length);
    let fence = false;
    text.split('\n').forEach((raw, i) => {
      if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; return; }
      if (fence) return;
      const line = raw.replace(/`[^`]*`/g, '').replace(/<(code|pre)\b[\s\S]*?<\/\1>/gi, '').replace(/https?:\/\/\S+/g, '');
      for (const [id, re, why] of RULES) {
        const m = line.match(re);
        if (m) hits.push({ file: f, line: i + 1 + offsetLines, rule: id, match: m[0].trim(), why, text: raw.trim().slice(0, 140) });
      }
    });
  }
  if (args.json) console.log(JSON.stringify({ hits: hits.length, items: hits, issues: [] }, null, 2));
  else {
    for (const h of hits) console.log(`${h.file}:${h.line} [${h.rule}] "${h.match}" -> ${h.why}\n    ${h.text}`);
    console.log(`${hits.length} hits`);
  }
  return hits.length ? 1 : 0;
}, 'node slop-check.mjs <file...> [--json]');
