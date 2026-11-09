#!/usr/bin/env node
// Skill lint: static checks on every skill folder, no Claude needed. It proves a skill is well formed
// (the structure Claude Code needs to find and read it), NOT that Claude will choose it for a request.
// Triggering is checked only by the optional runner (run-claude-checks.mjs), which uses Claude usage.
//
// Errors (exit 1):   no SKILL.md, no frontmatter, no name or description, name differs from the folder,
//                    description over 1024 characters, a markdown link to a file that does not exist,
//                    a triggers.json that is not valid.
// Warnings (exit 0): a short description, no "use when" cue in the description, no trigger fixtures,
//                    fewer than 3 should / 2 shouldNot phrases, two skills with near-identical descriptions,
//                    and, with --no-placeholders, leftover <...> placeholders.
//
// Usage: node check-skills.mjs [--skills-dir <dir> ...] [--no-placeholders] [--strict]
//   --skills-dir   folder that holds skill folders (repeatable; default .claude/skills)
//   --strict       treat warnings as errors
//
// Trigger fixtures: <skill folder>/triggers.json = { "should": ["phrase", ...], "shouldNot": ["phrase", ...] }.
// A skill with `disable-model-invocation: true` is started by hand, so it needs no fixtures.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_DESCRIPTION_CHARS = 1024;
const SHORT_DESCRIPTION_CHARS = 40;
const OVERLAP_THRESHOLD = 0.6;
const MIN_SHOULD = 3;
const MIN_SHOULD_NOT = 2;

const STOPWORDS = new Set(
  'about after also and any are because been before being between both but can could does each for from have into its just like make more most must needs only other over same some such than that the their them then there these they this those through under until use used uses using very was were what when where which while will with without you your'.split(
    ' ',
  ),
);

/** Reads the `---` frontmatter block of a markdown file (simple `key: value` lines, plus `>` and `|` blocks). */
export function parseFrontmatter(text) {
  const normalized = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { data: null, body: normalized };
  const end = normalized.indexOf('\n---', 4);
  if (end === -1) return { data: null, body: normalized };
  const lines = normalized.slice(4, end).split('\n');
  const body = normalized.slice(end + 4).replace(/^\n+/, '');
  const data = {};
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value === '>' || value === '|' || value === '') {
      const parts = [];
      while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1])) {
        index += 1;
        parts.push(lines[index].trim());
      }
      value = parts.join(' ');
    } else if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[match[1]] = value;
  }
  return { data, body };
}

/** Removes fenced code blocks and inline code, where links and placeholders are examples, not content. */
export function stripCode(text) {
  return String(text).replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '').replace(/`[^`\n]*`/g, '');
}

/** Relative markdown links in a document: `[text](path)`, without web links, anchors and mailto. */
export function findRelativeLinks(markdown) {
  const links = [];
  const pattern = /\[[^\]]*\]\(([^)\s]+)\)/g;
  for (const match of stripCode(markdown).matchAll(pattern)) {
    const target = match[1].split('#')[0];
    if (target && !/^(https?:|mailto:|tel:|\/\/)/i.test(target)) links.push(target);
  }
  return links;
}

/** True when the description says when to use the skill ("Use when ...", "Use before ...", "Use once ..."). */
export function hasTriggerCue(description) {
  return /\buse\b[^.]{0,60}\b(when|before|after|once|whenever|for|to)\b|\bwhen (the user|asked|a|an|you|someone)\b/i.test(
    description,
  );
}

/** The distinctive words of a description, for comparing two skills. */
export function significantWords(text) {
  const words = String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));
  return new Set(words);
}

/** Share of distinctive words two descriptions have in common (0 to 1). */
export function descriptionSimilarity(first, second) {
  const a = significantWords(first);
  const b = significantWords(second);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Pairs of skills whose descriptions are close enough that Claude may not tell them apart. */
export function findOverlaps(skills, threshold = OVERLAP_THRESHOLD) {
  const overlaps = [];
  for (let i = 0; i < skills.length; i += 1) {
    for (let j = i + 1; j < skills.length; j += 1) {
      const similarity = descriptionSimilarity(skills[i].description, skills[j].description);
      if (similarity >= threshold) overlaps.push({ first: skills[i].name, second: skills[j].name, similarity });
    }
  }
  return overlaps;
}

/** Checks the content of a `triggers.json`. Returns `{ problems, shouldCount, shouldNotCount }`. */
export function validateFixtures(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { problems: ['triggers.json is not valid JSON'], shouldCount: 0, shouldNotCount: 0 };
  }
  const problems = [];
  const isPhraseList = (value) =>
    Array.isArray(value) && value.every((phrase) => typeof phrase === 'string' && phrase.trim() !== '');
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { problems: ['triggers.json must be an object with "should" and "shouldNot"'], shouldCount: 0, shouldNotCount: 0 };
  }
  if (!isPhraseList(parsed.should)) problems.push('"should" must be a list of non-empty phrases');
  if (parsed.shouldNot !== undefined && !isPhraseList(parsed.shouldNot)) {
    problems.push('"shouldNot" must be a list of non-empty phrases');
  }
  return {
    problems,
    shouldCount: Array.isArray(parsed.should) ? parsed.should.length : 0,
    shouldNotCount: Array.isArray(parsed.shouldNot) ? parsed.shouldNot.length : 0,
  };
}

/**
 * Lints one skill. `skill` = { folder, dir, text (SKILL.md or null), fixturesText (or null) }.
 * Returns `{ name, description, issues }`, where each issue is `{ level: 'error' | 'warn', code, message }`.
 */
export function lintSkill(skill, options = {}) {
  const issues = [];
  const add = (level, code, message) => issues.push({ level, code, message });
  if (skill.text === null) {
    add('error', 'missing-skill-file', 'no SKILL.md in this folder');
    return { name: skill.folder, description: '', issues };
  }

  const { data, body } = parseFrontmatter(skill.text);
  if (!data) {
    add('error', 'no-frontmatter', 'SKILL.md must start with a --- frontmatter block');
    return { name: skill.folder, description: '', issues };
  }

  if (!data.name) add('error', 'missing-name', 'frontmatter has no "name"');
  else if (data.name !== skill.folder) add('error', 'name-mismatch', `name "${data.name}" differs from the folder "${skill.folder}"`);

  // A skill with `disable-model-invocation: true` is started by hand (a slash command), so Claude never
  // picks it from its description: it needs neither a trigger cue nor trigger fixtures.
  const startedByHand = String(data['disable-model-invocation']).toLowerCase() === 'true';

  const description = data.description ?? '';
  if (!description) add('error', 'missing-description', 'frontmatter has no "description"');
  else {
    if (description.length > MAX_DESCRIPTION_CHARS) {
      add('error', 'description-too-long', `description is ${description.length} characters (limit ${MAX_DESCRIPTION_CHARS})`);
    }
    if (description.length < SHORT_DESCRIPTION_CHARS) add('warn', 'description-short', `description is only ${description.length} characters`);
    if (!startedByHand && !hasTriggerCue(description)) {
      add('warn', 'no-trigger-cue', 'description does not say when to use the skill ("Use when ...")');
    }
  }

  for (const link of findRelativeLinks(body)) {
    if (!existsSync(resolve(skill.dir, link))) add('error', 'broken-link', `link to "${link}" does not exist`);
  }

  if (options.noPlaceholders) {
    const placeholders = stripCode(body).match(/<(?:\.\.\.|[A-Z][A-Za-z0-9 _.\/-]{1,60})>/g);
    if (placeholders) add('warn', 'placeholder', `leftover placeholder ${[...new Set(placeholders)].slice(0, 3).join(', ')}`);
  }

  if (skill.fixturesText === null) {
    if (!startedByHand) add('warn', 'no-fixtures', 'no triggers.json (phrases that should and should not trigger this skill)');
  } else {
    const checked = validateFixtures(skill.fixturesText);
    for (const problem of checked.problems) add('error', 'bad-fixtures', problem);
    if (checked.problems.length === 0 && (checked.shouldCount < MIN_SHOULD || checked.shouldNotCount < MIN_SHOULD_NOT)) {
      add('warn', 'few-fixtures', `triggers.json has ${checked.shouldCount} should and ${checked.shouldNotCount} shouldNot (aim for ${MIN_SHOULD}+ and ${MIN_SHOULD_NOT}+)`);
    }
  }

  return { name: data.name || skill.folder, description, issues };
}

/** Reads every skill folder under one skills directory. */
export function readSkillFolders(skillsDir) {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir)
    .filter((entry) => statSync(join(skillsDir, entry)).isDirectory())
    .sort()
    .map((folder) => {
      const dir = join(skillsDir, folder);
      const skillFile = join(dir, 'SKILL.md');
      const fixturesFile = join(dir, 'triggers.json');
      return {
        folder,
        dir,
        text: existsSync(skillFile) ? readFileSync(skillFile, 'utf8') : null,
        fixturesText: existsSync(fixturesFile) ? readFileSync(fixturesFile, 'utf8') : null,
      };
    });
}

/**
 * Lints all skills in the given directories. Returns `{ results, overlaps, errors, warnings, skillsDirs }`.
 * A missing directory is reported as a warning, not a failure.
 */
export function checkSkills(skillsDirs, options = {}) {
  const results = [];
  const directoryWarnings = [];
  for (const skillsDir of skillsDirs) {
    if (!existsSync(skillsDir)) {
      directoryWarnings.push(`skills folder not found: ${skillsDir}`);
      continue;
    }
    for (const skill of readSkillFolders(skillsDir)) results.push({ ...lintSkill(skill, options), dir: skill.dir });
  }
  const overlaps = findOverlaps(results.filter((result) => result.description));
  const errors = results.reduce((count, result) => count + result.issues.filter((issue) => issue.level === 'error').length, 0);
  const warnings =
    results.reduce((count, result) => count + result.issues.filter((issue) => issue.level === 'warn').length, 0) +
    overlaps.length +
    directoryWarnings.length;
  return { results, overlaps, errors, warnings, directoryWarnings, skillsDirs };
}

/** Readable report lines for a `checkSkills` result. */
export function formatReport(report) {
  const lines = [];
  for (const warning of report.directoryWarnings) lines.push(`warning: ${warning}`);
  for (const result of report.results) {
    if (result.issues.length === 0) {
      lines.push(`ok    ${result.name}`);
      continue;
    }
    for (const issue of result.issues) lines.push(`${issue.level === 'error' ? 'ERROR' : 'warn '} ${result.name}: ${issue.message} [${issue.code}]`);
  }
  for (const overlap of report.overlaps) {
    lines.push(`warn  ${overlap.first} and ${overlap.second}: descriptions overlap by ${Math.round(overlap.similarity * 100)}%, Claude may not tell them apart [overlap]`);
  }
  lines.push(`${report.results.length} skills checked: ${report.errors} errors, ${report.warnings} warnings. Structure only: triggering is not verified by this check.`);
  return lines;
}

function parseArguments(argv) {
  const options = { skillsDirs: [], noPlaceholders: false, strict: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--skills-dir' && argv[index + 1]) options.skillsDirs.push(argv[(index += 1)]);
    else if (argv[index] === '--no-placeholders') options.noPlaceholders = true;
    else if (argv[index] === '--strict') options.strict = true;
  }
  if (options.skillsDirs.length === 0) options.skillsDirs.push('.claude/skills');
  return options;
}

/** The exit code: 1 when there are errors (or warnings with --strict). */
export function exitCodeFor(report, strict = false) {
  return report.errors > 0 || (strict && report.warnings > 0) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArguments(process.argv.slice(2));
  const report = checkSkills(options.skillsDirs.map((dir) => resolve(dir)), options);
  console.log(formatReport(report).join('\n'));
  process.exit(exitCodeFor(report, options.strict));
}
