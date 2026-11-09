#!/usr/bin/env node
// Overview check: compares the facts written in a project's overview (AGENTS.md) with the project on disk,
// so stale lines are found by a script and not by memory. It REPORTS; it never edits the overview.
//
// What it checks (deterministic, no Claude needed):
//   missing-path    a file or folder named in `backticks` that is not in the project
//   missing-script  an `npm run <name>` (or `npm test`, `npm start`) that package.json does not define
//   version         a version written next to a package name that differs from package.json
//   undocumented    a folder whose children the overview lists, where one child is missing from the list
//   label           a planning label such as "(bucket 5a)" left in the overview
// What it cannot check: whether a sentence about behaviour is still true. The write-project-overview skill
// reads those lines itself and marks them unverified when it cannot confirm them.
//
// Usage: node overview-check.mjs [--root <project folder>] [--file <overview path>] [--strict]
//   --file     the overview to check (default: AGENTS.md in the root)
//   --strict   exit 1 when anything is found (default: always exit 0, like the doc-size report)

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Folders never searched: dependencies, build output and generated files. */
const SKIPPED_FOLDERS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.expo']);

/** A backticked word with one of these extensions (and no slash) is treated as a file name. */
const FILE_EXTENSIONS = new Set(['md', 'mdx', 'json', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'yaml', 'yml', 'sh', 'css', 'html', 'toml']);

/** How the overview may write a package that has a different package.json name. */
const DISPLAY_NAMES = { 'Expo SDK': 'expo', 'React Native': 'react-native', React: 'react', TypeScript: 'typescript', Vitest: 'vitest', Jest: 'jest' };

const NPM_SCRIPT_PATTERN = /\bnpm (?:run )?(test|start)\b|\bnpm run ([\w:.-]+)/g;
const PLANNING_LABEL_PATTERN = /\bbucket \d+[a-z]?\b/gi;

/** Every file and folder of the project as a relative path with forward slashes, skipping generated folders. */
export function listProjectEntries(root) {
  const entries = [];
  const visit = (relativeFolder) => {
    for (const item of readdirSync(join(root, relativeFolder), { withFileTypes: true })) {
      if (item.isDirectory() && SKIPPED_FOLDERS.has(item.name)) continue;
      const relativePath = relativeFolder ? `${relativeFolder}/${item.name}` : item.name;
      entries.push(relativePath);
      if (item.isDirectory()) visit(relativePath);
    }
  };
  visit('');
  return entries;
}

/** Every `inline code` span with its 1-based line number. */
export function extractInlineCode(lines) {
  const spans = [];
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/`([^`]+)`/g)) spans.push({ line: index + 1, code: match[1] });
  });
  return spans;
}

/** True when the code span names a file or folder (and is not a command, a placeholder or a function call). */
export function looksLikePath(code) {
  if (/\s/.test(code) || /[<>*{}$=,;|]/.test(code) || /^https?:/.test(code)) return false;
  if (/\w\(.*\)$/.test(code)) return false; // a call such as useTheme(), not a path; a route group "(tabs)/x" still passes
  if (/\w\.\w+\//.test(code)) return false; // object access such as "haptic.tap/selection", not a folder
  const extension = code.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return code.includes('/') || FILE_EXTENSIONS.has(extension);
}

/** The path as the overview means it: "@/" is the source alias for "src/", no "./" and no trailing slash. */
export function normalizePathText(pathText) {
  return pathText.replace(/^@\//, 'src/').replace(/^\.\//, '').replace(/\/+$/, '');
}

/** The project entries a written path can mean: the same path, or the path as the end of a longer one. */
export function findMatchingEntries(entries, pathText) {
  const wanted = normalizePathText(pathText);
  return entries.filter((entry) => entry === wanted || entry.endsWith(`/${wanted}`));
}

/** Names from .gitignore that are plain files or folders (no patterns), without slashes. */
export function readIgnoredNames(gitignoreText) {
  const names = new Set();
  for (const rawLine of gitignoreText.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!') || line.includes('*')) continue;
    names.add(line.replace(/^\/+|\/+$/g, ''));
  }
  return names;
}

/** True when the path, or a folder above it, is ignored by git (so it may be generated and absent). */
export function isIgnoredPath(pathText, ignoredNames) {
  const segments = normalizePathText(pathText).split('/');
  return segments.some((_, index) => ignoredNames.has(segments.slice(0, index + 1).join('/')));
}

/** True when the first segment is a dependency, e.g. "expo-router/js-tabs" is an import path, not a file. */
function isPackageImportPath(pathText, dependencies) {
  const segments = pathText.split('/');
  const packageName = pathText.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
  return packageName in dependencies;
}

function findMissingPaths({ spans, entries, dependencies, ignoredNames }) {
  const findings = [];
  for (const { line, code } of spans) {
    if (!looksLikePath(code) || isPackageImportPath(code, dependencies)) continue;
    if (findMatchingEntries(entries, code).length > 0 || isIgnoredPath(code, ignoredNames)) continue;
    findings.push({ line, kind: 'missing-path', message: `\`${code}\` is not in the project` });
  }
  return findings;
}

function findMissingScripts({ lines, scripts }) {
  const findings = [];
  lines.forEach((text, index) => {
    for (const match of text.matchAll(NPM_SCRIPT_PATTERN)) {
      const scriptName = match[1] ?? match[2];
      if (!(scriptName in scripts)) {
        findings.push({ line: index + 1, kind: 'missing-script', message: `package.json has no script "${scriptName}"` });
      }
    }
  });
  return findings;
}

function escapeForPattern(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The numbers of a version or range ("~58.0.23" gives [58, 0, 23]). */
function versionNumbers(versionText) {
  return (versionText.match(/\d+(?:\.\d+)*/)?.[0] ?? '').split('.').filter(Boolean).map(Number);
}

/** True when what the overview wrote ("0.88") is the start of the installed version (0.88.1). */
function isVersionPrefix(writtenNumbers, installedNumbers) {
  return writtenNumbers.every((number, index) => installedNumbers[index] === number);
}

function findVersionMismatches({ lines, dependencies }) {
  const namesToPackages = { ...DISPLAY_NAMES };
  for (const packageName of Object.keys(dependencies)) namesToPackages[packageName] = packageName;

  const findings = [];
  lines.forEach((text, index) => {
    for (const [writtenName, packageName] of Object.entries(namesToPackages)) {
      if (!(packageName in dependencies)) continue;
      const pattern = new RegExp(`(?<![\\w@/.-])${escapeForPattern(writtenName)}\\s+[~^]?(\\d+(?:\\.\\d+)*)(?!\\w)`, 'g');
      for (const match of text.matchAll(pattern)) {
        const installedRange = dependencies[packageName];
        if (!isVersionPrefix(versionNumbers(match[1]), versionNumbers(installedRange))) {
          findings.push({ line: index + 1, kind: 'version', message: `${writtenName} ${match[1]} written, package.json has ${installedRange}` });
        }
      }
    }
  });
  return findings;
}

function findPlanningLabels({ lines }) {
  const findings = [];
  lines.forEach((text, index) => {
    for (const match of text.matchAll(PLANNING_LABEL_PATTERN)) {
      findings.push({ line: index + 1, kind: 'label', message: `planning label "${match[0]}" in the overview (state the fact, not the plan step)` });
    }
  });
  return findings;
}

/** The lines that describe the item written on `startLine`: that line plus the lines indented under it. */
export function describingRegion(lines, startLine) {
  const startText = lines[startLine - 1];
  const startIndent = startText.length - startText.trimStart().length;
  const region = [startText];
  for (const text of lines.slice(startLine)) {
    if (text.trim() === '') break;
    const indent = text.length - text.trimStart().length;
    if (indent <= startIndent && /^[-*]\s/.test(text.trim())) break;
    region.push(text);
  }
  return region.join('\n');
}

/** The names a child may be written as: its full name, without extension, and without the folder's category suffix. */
function writtenNamesOf(childName, folderName) {
  const withoutExtension = childName.replace(/\.[a-z0-9]+$/i, '');
  // "icons" holds "CheckIcon", and the overview may list it as "Check".
  const categorySuffix = folderName.replace(/s$/, '').replace(/^./, (letter) => letter.toUpperCase());
  const names = [childName, withoutExtension];
  if (withoutExtension.endsWith(categorySuffix) && withoutExtension.length > categorySuffix.length) {
    names.push(withoutExtension.slice(0, -categorySuffix.length));
  }
  return names;
}

function isNameInText(name, text) {
  return new RegExp(`(?<!\\w)${escapeForPattern(name)}(?!\\w)`).test(text);
}

/** Immediate children worth listing: not hidden, not a barrel (index) file, not a test, not a README or LICENSE. */
function listedChildren(entries, folder) {
  return entries.filter((entry) => {
    if (!entry.startsWith(`${folder}/`)) return false;
    const name = entry.slice(folder.length + 1);
    const isMetaFile = /^(README|LICENSE)(\.|$)/i.test(name);
    return !name.includes('/') && !name.startsWith('.') && !/^index\./.test(name) && !/\.(test|spec)\./.test(name) && !isMetaFile;
  });
}

/** Entries the overview names by a path that points to exactly one thing (an ambiguous path proves nothing). */
function uniquelyNamedEntries(spans, entries) {
  const named = new Set();
  for (const { code } of spans) {
    if (!looksLikePath(code)) continue;
    const matches = findMatchingEntries(entries, code);
    if (matches.length === 1) named.add(matches[0]);
  }
  return named;
}

function isCoveredByNamedEntry(child, namedEntries) {
  return [...namedEntries].some((entry) => entry === child || entry.startsWith(`${child}/`));
}

/**
 * For a folder the overview lists children of (at least two of them), reports the children it forgot.
 * A child counts as listed when its name is in the lines describing the folder, or when some other line
 * names it by its own path.
 */
function findUndocumentedChildren({ lines, spans, entries }) {
  const namedEntries = uniquelyNamedEntries(spans, entries);
  const checkedFolders = new Set();
  const findings = [];

  for (const { line, code } of spans) {
    if (!looksLikePath(code)) continue;
    const matches = findMatchingEntries(entries, code);
    const folder = matches.length === 1 ? matches[0] : null;
    if (!folder || checkedFolders.has(folder) || !entries.some((entry) => entry.startsWith(`${folder}/`))) continue;

    const children = listedChildren(entries, folder);
    const region = describingRegion(lines, line);
    const folderName = folder.split('/').pop();
    const isWrittenInRegion = (child) =>
      writtenNamesOf(child.slice(folder.length + 1), folderName).some((name) => isNameInText(name, region));
    if (children.filter(isWrittenInRegion).length < 2) continue; // the overview does not list this folder's content, so nothing can be missing
    checkedFolders.add(folder);

    for (const child of children.filter((entry) => !isWrittenInRegion(entry) && !isCoveredByNamedEntry(entry, namedEntries))) {
      findings.push({ line, kind: 'undocumented', message: `\`${child}\` exists but is missing from the list for \`${code}\`` });
    }
  }
  return findings;
}

/**
 * Checks the overview text against the project. Inputs: `text`; `entries` (see listProjectEntries);
 * `packageJson` (parsed, or null); `gitignoreText`. Returns findings `{ line, kind, message }`, in line order.
 */
export function checkOverview({ text, entries, packageJson = null, gitignoreText = '' }) {
  const lines = text.split('\n');
  const spans = extractInlineCode(lines);
  const dependencies = { ...packageJson?.devDependencies, ...packageJson?.dependencies };
  const context = { lines, spans, entries, dependencies, ignoredNames: readIgnoredNames(gitignoreText), scripts: packageJson?.scripts };

  const findings = [
    ...findMissingPaths(context),
    ...(packageJson ? findMissingScripts(context) : []),
    ...(packageJson ? findVersionMismatches(context) : []),
    ...findUndocumentedChildren(context),
    ...findPlanningLabels(context),
  ];
  return findings.sort((first, second) => first.line - second.line);
}

/** Report lines for the findings of one overview file. */
export function formatOverviewReport(findings, fileLabel) {
  if (findings.length === 0) return [`${fileLabel}: every checkable statement matches the project (behaviour statements are not checked).`];
  const lines = findings.map((finding) => `${fileLabel}:${finding.line}  [${finding.kind}]  ${finding.message}`);
  lines.push(`${findings.length} finding(s). This only reports; edit the overview after checking each one.`);
  return lines;
}

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const valueOf = (flag) => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : undefined);
  const root = resolve(valueOf('--root') ?? process.cwd());
  const overviewPath = resolve(root, valueOf('--file') ?? 'AGENTS.md');
  const text = readIfExists(overviewPath);
  if (text === null) {
    console.log(`No overview found at ${overviewPath}; nothing to check.`);
    process.exit(0);
  }
  const packageText = readIfExists(join(root, 'package.json'));
  const findings = checkOverview({
    text,
    entries: listProjectEntries(root),
    packageJson: packageText ? JSON.parse(packageText) : null,
    gitignoreText: readIfExists(join(root, '.gitignore')) ?? '',
  });
  console.log(formatOverviewReport(findings, overviewPath.slice(root.length + 1).split('\\').join('/')).join('\n'));
  process.exit(argv.includes('--strict') && findings.length > 0 ? 1 : 0);
}
