/**
 * The analyst's background reading: Markdown files under `knowledge/`.
 *
 * Files, not a vector store, on purpose. A question about one symbol needs the
 * method, the instructions and one or two economies — picked by currency, which
 * is exact — and the whole set fits the model's context many times over. Files
 * in git are also reviewable line by line, which is the point: every claim in
 * them cites an official source and carries an as-of date, and the user reads
 * them before the model leans on them.
 *
 * `knowledge/ANALYST.md` IS the system prompt. Tuning the analyst is editing
 * prose, not code.
 *
 * On Vercel the folder reaches the function through `outputFileTracingIncludes`
 * in next.config.ts; without it these reads would find nothing in production.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assetReadingKey, economiesOf } from '@/config/ai.config';
import type { SymbolDefinition } from '@/config/symbols.config';

export interface KnowledgeFile {
  id: string;
  title: string;
  /** `YYYY-MM-DD` the file was last checked against its sources. */
  asOf: string;
  sources: string[];
  body: string;
}

export interface KnowledgeSelection {
  /** ANALYST.md, verbatim. */
  system: string;
  /** Methodology and the economy/asset profiles, each with its date and sources. */
  background: string;
  files: { id: string; title: string; asOf: string }[];
  /** Profiles that would apply but do not exist yet (e.g. ZAR). */
  missing: string[];
}

export const KNOWLEDGE_DIR = path.join(process.cwd(), 'knowledge');

/**
 * Minimal front-matter: `title:`, `asOf:` and a `sources:` list of `- item`
 * lines. No YAML dependency for three fields.
 */
export function parseKnowledge(id: string, raw: string): KnowledgeFile {
  const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) throw new Error(`knowledge/${id}.md has no front-matter`);

  let title = id;
  let asOf = '';
  const sources: string[] = [];
  let inSources = false;
  for (const line of match[1].split('\n')) {
    const field = line.match(/^(\w+):\s*(.*)$/);
    if (field) {
      inSources = field[1] === 'sources';
      if (field[1] === 'title') title = field[2].trim();
      if (field[1] === 'asOf') asOf = field[2].trim();
      continue;
    }
    const item = line.match(/^\s*-\s+(.+)$/);
    if (inSources && item) sources.push(item[1].trim());
  }
  return { id, title, asOf, sources, body: text.slice(match[0].length).trim() };
}

const cache = new Map<string, KnowledgeFile | null>();

function readKnowledge(id: string, dir: string): KnowledgeFile | null {
  const key = `${dir}|${id}`;
  if (cache.has(key)) return cache.get(key)!;
  let file: KnowledgeFile | null = null;
  try {
    file = parseKnowledge(id, readFileSync(path.join(dir, `${id}.md`), 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  cache.set(key, file);
  return file;
}

const ASSET_FILE: Record<string, string | null> = {
  metals: 'assets/gold',
  energy: 'assets/oil',
  indices: 'assets/indices',
  crypto: 'assets/crypto',
  copper: null,
};

/** Which background files a symbol reads, in the order the model sees them. */
export function knowledgeIdsFor(def: SymbolDefinition): string[] {
  const asset = assetReadingKey(def);
  const assetFile = asset ? ASSET_FILE[asset] : null;
  return ['METHODOLOGY', ...(assetFile ? [assetFile] : []), ...economiesOf(def).map((c) => `currencies/${c}`)];
}

export function selectKnowledge(def: SymbolDefinition, dir = KNOWLEDGE_DIR): KnowledgeSelection {
  const analyst = readKnowledge('ANALYST', dir);
  if (!analyst) throw new Error('knowledge/ANALYST.md is missing — the analyst has no instructions');

  const files: KnowledgeFile[] = [];
  const missing: string[] = [];
  for (const id of knowledgeIdsFor(def)) {
    const file = readKnowledge(id, dir);
    if (file) files.push(file);
    else missing.push(id);
  }

  const background = files
    .map((f) => `<<< background file: ${f.title} (as of ${f.asOf}; sources: ${f.sources.join(' ; ')}) >>>\n${f.body}`)
    .join('\n\n');

  return {
    system: analyst.body,
    background,
    files: [analyst, ...files].map((f) => ({ id: f.id, title: f.title, asOf: f.asOf })),
    missing,
  };
}
