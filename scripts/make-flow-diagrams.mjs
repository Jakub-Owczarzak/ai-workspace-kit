// Kit development only (not shipped). Draws the three workflow diagrams (solo, team, org) as SVG files in
// docs/diagrams/, in the style of a boxed pipeline: a box per stage with a title and a subtitle, who acts on it,
// whether something blocks there, a note above, and colored loops for the ways back.
//
//   node scripts/make-flow-diagrams.mjs          writes docs/diagrams/flow-<profile>.svg
//
// A test checks that the committed files are exactly what this script produces, so the diagrams cannot drift.
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'diagrams');

const COLOR = {
  page: '#0d1117',
  box: '#161b22',
  line: '#3d444d',
  text: '#e6edf3',
  dim: '#9da7b3',
  you: '#e3b341',
  ai: '#58a6ff',
  run: '#3fb950',
  hard: '#f85149',
  orange: '#f0883e',
  blue: '#58a6ff',
};
const FONT = "'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif";

// Geometry (the viewBox is 1200 wide so the text stays readable when GitHub scales it to the page).
const WIDTH = 1200;
const HEIGHT = 600;
const LEFT = 37;
const STEP = 144;
const BOX_W = 118;
const BOX_H = 84;
const BOX_Y = 196;
const LOOP_TOP = BOX_Y + BOX_H;

const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Greedy word wrap by character count (an SVG cannot measure text, so the widths are estimates). */
export function wrap(text, maxChars) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > maxChars) {
      lines.push(line);
      line = word;
    } else line = line ? line + ' ' + word : word;
  }
  if (line) lines.push(line);
  return lines;
}

const centerX = (index) => LEFT + index * STEP + BOX_W / 2;

function chip(x, y, label, color, textColor = COLOR.page) {
  const width = Math.round(label.length * 6.6 + 12);
  return {
    width,
    svg:
      `<rect x="${x}" y="${y}" width="${width}" height="17" rx="8.5" fill="${color}"/>` +
      `<text x="${x + width / 2}" y="${y + 12.2}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${textColor}">${label}</text>`,
  };
}

function stageSvg(index, stage) {
  const x = LEFT + index * STEP;
  const parts = [];

  // The note above the box: what happens here and who decides.
  const noteLines = wrap(stage.note, 21);
  const noteTop = BOX_Y - 22 - noteLines.length * 15;
  noteLines.forEach((line, i) => {
    parts.push(`<text x="${x + BOX_W / 2}" y="${noteTop + 11 + i * 15}" text-anchor="middle" font-size="12" fill="${COLOR.dim}">${escapeXml(line)}</text>`);
  });

  // The box.
  const border = stage.hard ? COLOR.hard : COLOR.line;
  parts.push(
    `<rect x="${x}" y="${BOX_Y}" width="${BOX_W}" height="${BOX_H}" rx="12" fill="${COLOR.box}" stroke="${border}" stroke-width="${stage.hard ? 2 : 1.4}"/>`
  );
  parts.push(`<text x="${x + BOX_W / 2}" y="${BOX_Y + 38}" text-anchor="middle" font-size="16" font-weight="700" fill="${COLOR.text}">${escapeXml(stage.title)}</text>`);
  wrap(stage.sub, 17).forEach((line, i) => {
    parts.push(`<text x="${x + BOX_W / 2}" y="${BOX_Y + 56 + i * 14}" text-anchor="middle" font-size="12" fill="${COLOR.dim}">${escapeXml(line)}</text>`);
  });

  // Who acts: chips on the top border. Where something blocks: a red HARD chip on the bottom border.
  let cursor = x + 8;
  for (const actor of stage.actors) {
    const color = { YOU: COLOR.you, AI: COLOR.ai, RUN: COLOR.run }[actor];
    const made = chip(cursor, BOX_Y - 9, actor, color);
    parts.push(made.svg);
    cursor += made.width + 5;
  }
  if (stage.hard) {
    // Bottom-right corner: the loops leave from the middle of a box and arrive left of the middle of Build.
    const hardWidth = chip(0, 0, 'HARD', COLOR.hard).width;
    parts.push(chip(x + BOX_W - 8 - hardWidth, BOX_Y + BOX_H - 9, 'HARD', COLOR.hard, '#ffffff').svg);
  }

  // The arrow into the next stage.
  if (index < 7) {
    const y = BOX_Y + BOX_H / 2;
    parts.push(`<line x1="${x + BOX_W + 3}" y1="${y}" x2="${x + STEP - 4}" y2="${y}" stroke="${COLOR.dim}" stroke-width="1.6" marker-end="url(#arrow)"/>`);
  }
  return parts.join('\n');
}

/** A way back: down from one box, left along a line, and up into the Build box. */
function loopSvg(loop) {
  const fromX = centerX(loop.from);
  const toX = centerX(2) + loop.arriveOffset;
  const markerId = `arrow-${loop.name}`;
  // The label starts to the right of the three arrows that arrive under Build, and stops before the next loop's
  // vertical line (`limitX`), so it never runs into a line.
  const labelX = centerX(2) + 24;
  const maxChars = Math.max(18, Math.floor((loop.limitX - labelX - 10) / 6.5));
  const labelSvg = wrap(loop.label, maxChars)
    .map((line, i) => `<text x="${labelX}" y="${loop.y + 17 + i * 15}" font-size="12.5" fill="${loop.color}">${escapeXml(line)}</text>`)
    .join('\n');
  return (
    `<path d="M ${fromX} ${LOOP_TOP + 2} V ${loop.y} H ${toX} V ${LOOP_TOP + 4}" fill="none" stroke="${loop.color}" stroke-width="2" stroke-linejoin="round" marker-end="url(#${markerId})"/>\n` +
    labelSvg
  );
}

const marker = (id, color) =>
  `<marker id="${id}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/></marker>`;

function legendSvg(y) {
  const items = [
    ['YOU', COLOR.you, 'a person decides or acts: approves, asks, pushes, merges'],
    ['AI', COLOR.ai, 'the assistant, working under the rules and skills'],
    ['RUN', COLOR.run, 'a script, a git hook or a CI job'],
    ['HARD', COLOR.hard, 'something blocks (only where the hook or tool is installed)'],
  ];
  const parts = [];
  items.forEach(([label, color, text], i) => {
    const column = i % 2;
    const row = Math.floor(i / 2);
    const x = 37 + column * 560;
    const rowY = y + row * 26;
    const made = chip(x, rowY, label, color, label === 'HARD' ? '#ffffff' : COLOR.page);
    parts.push(made.svg);
    parts.push(`<text x="${x + made.width + 10}" y="${rowY + 13}" font-size="12.5" fill="${COLOR.dim}">${escapeXml(text)}</text>`);
  });
  parts.push(
    `<text x="37" y="${y + 70}" font-size="12.5" fill="${COLOR.dim}">In no profile does anything push, open a pull request or merge by itself. The profile changes how much a machine blocks, not whether a person decides.</text>`
  );
  return parts.join('\n');
}

export function buildDiagram(spec) {
  const arrowDefs =
    marker('arrow', COLOR.dim) + marker('arrow-fail', COLOR.orange) + marker('arrow-changes', COLOR.blue) + marker('arrow-hook', COLOR.hard);
  const stages = spec.stages.map((stage, index) => stageSvg(index, stage)).join('\n');
  const loops = spec.loops.map(loopSvg).join('\n');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" ` +
    `aria-label="${escapeXml(spec.ariaLabel)}" font-family="${FONT}">\n` +
    `<title>${escapeXml(spec.ariaLabel)}</title>\n` +
    `<defs>${arrowDefs}</defs>\n` +
    `<rect x="1" y="1" width="${WIDTH - 2}" height="${HEIGHT - 2}" rx="16" fill="${COLOR.page}" stroke="${COLOR.line}" stroke-width="2"/>\n` +
    `<text x="37" y="48" font-size="24" font-weight="700" fill="${COLOR.text}">${escapeXml(spec.title)}</text>\n` +
    `<text x="37" y="72" font-size="14" fill="${COLOR.dim}">${escapeXml(spec.subtitle)}</text>\n` +
    `${stages}\n${loops}\n${legendSvg(HEIGHT - 112)}\n</svg>\n`
  );
}

// ---- the three profiles --------------------------------------------------------------------------------------

const LOOPS = (hookLabel) => [
  { name: 'fail', from: 3, y: LOOP_TOP + 44, arriveOffset: 0, color: COLOR.orange, limitX: centerX(4), label: 'FAIL: the assistant gets the log and fixes it' },
  { name: 'changes', from: 4, y: LOOP_TOP + 92, arriveOffset: -17, color: COLOR.blue, limitX: centerX(5), label: 'CHANGES: a blocking finding is fixed, then reviewed again' },
  { name: 'hook', from: 5, y: LOOP_TOP + 140, arriveOffset: -34, color: COLOR.hard, limitX: WIDTH - 40, label: hookLabel },
];

const SOLO = {
  ariaLabel: 'Solo workflow: plan, build, verify, review, commit, push, pull request, with who acts and where something blocks',
  title: 'Solo: one owner who reads every diff',
  subtitle: 'Light: advice and warnings. You approve the plan, ask for the commit, push and merge. Only the hooks you install block.',
  stages: [
    { title: 'You ask', sub: 'a change', actors: ['YOU'], note: 'a request in your own words' },
    { title: 'Plan', sub: 'Intent Anchor', actors: ['AI', 'YOU'], note: 'you approve the anchor, the bucket map and each bucket plan. Routine work is exempt' },
    { title: 'Build', sub: 'under the rules', actors: ['AI'], note: 'router and always-on rules. Bug fix: failing test first. Test guard is off' },
    { title: 'Verify', sub: 'lint, types, tests', actors: ['AI'], note: 'the assistant runs them and shows the real output' },
    { title: 'Review', sub: 'advisory', actors: ['AI'], note: 'reviewer subagent on the staged change. You read the diff too' },
    { title: 'Commit', sub: 'hook gate', actors: ['YOU', 'RUN'], hard: true, note: 'you ask for it. Hook: lint, types, tests. Docs check only warns. You give the changelog line' },
    { title: 'Push', sub: 'hook gate', actors: ['YOU', 'RUN'], hard: true, note: 'you push, never the assistant. Protected branch refused. Review: a reminder only' },
    { title: 'Pull request', sub: 'drafted, merged by you', actors: ['AI', 'YOU', 'RUN'], note: 'assistant drafts the text. You open it, CI runs, you merge. You merge the release PR' },
  ],
  loops: LOOPS('HOOK FAILS: the commit is blocked, fix and commit again'),
};

const TEAM = {
  ariaLabel: 'Team workflow: plan mode, fix-mode test guard, review, commit and push gates, with who acts and where something blocks',
  title: 'Team: a few developers on a shared repository',
  subtitle: 'Solo, plus a real stop on planning (plan mode) and a guard that protects existing tests during a bug fix.',
  stages: [
    { title: 'You ask', sub: 'a change', actors: ['YOU'], note: 'a request in your own words' },
    { title: 'Plan', sub: 'plan mode', actors: ['AI', 'YOU'], hard: true, note: 'you approve anchor, buckets and each plan. Nothing is edited until you accept the plan' },
    { title: 'Build', sub: 'fix mode guard', actors: ['AI'], hard: true, note: 'new logic is test-first. In fix mode the guard refuses edits to existing tests' },
    { title: 'Verify', sub: 'lint, types, tests', actors: ['AI'], note: 'the assistant runs them and shows the real output' },
    { title: 'Review', sub: 'advisory', actors: ['AI'], note: 'reviewer subagent on the staged change. You read the diff too' },
    { title: 'Commit', sub: 'hook gate', actors: ['YOU', 'RUN'], hard: true, note: 'you ask for it. Hook: lint, types, tests. Docs check only warns. You give the changelog line' },
    { title: 'Push', sub: 'hook gate', actors: ['YOU', 'RUN'], hard: true, note: 'you push, never the assistant. Protected branch refused. Review: a reminder only' },
    { title: 'Pull request', sub: 'drafted, merged by you', actors: ['AI', 'YOU', 'RUN'], note: 'assistant drafts the text. You open it, CI runs, you merge. You merge the release PR' },
  ],
  loops: LOOPS('HOOK FAILS: the commit is blocked, fix and commit again'),
};

const ORG = {
  ariaLabel: 'Org workflow: success measurements, plan mode, required review record, strict docs check, push gate, with who acts and where something blocks',
  title: 'Org: many developers, policies that must hold',
  subtitle: 'Team, plus success measurements, a docs check that blocks, and a review record the push hook requires.',
  stages: [
    { title: 'You ask', sub: 'a change', actors: ['YOU'], note: 'a request in your own words' },
    { title: 'Plan', sub: 'anchor + measures', actors: ['AI', 'YOU'], hard: true, note: 'anchor plus success measurements. Plan mode is the default: you accept before any edit' },
    { title: 'Build', sub: 'fix mode guard', actors: ['AI'], hard: true, note: 'new logic is test-first. In fix mode the guard refuses edits to existing tests' },
    { title: 'Verify', sub: 'lint, types, tests', actors: ['AI'], note: 'the assistant runs them and shows the real output' },
    { title: 'Review', sub: 'required', actors: ['AI'], note: 'the assistant must run the reviewer and record the result for these exact contents' },
    { title: 'Commit', sub: 'hook gate', actors: ['YOU', 'RUN'], hard: true, note: 'you ask for it. Hook: lint, types, tests. Docs check blocks until AGENTS.md is updated' },
    { title: 'Push', sub: 'hook gate', actors: ['YOU', 'RUN'], hard: true, note: 'you push. Protected branch refused. No clean review record: refused' },
    { title: 'Pull request', sub: 'drafted, merged by you', actors: ['AI', 'YOU', 'RUN'], note: 'assistant drafts the text. Your PR rules and colleagues apply. You merge, then the release PR' },
  ],
  loops: LOOPS('HOOK FAILS: the commit is blocked, fix and commit again'),
};

export const DIAGRAMS = { solo: SOLO, team: TEAM, org: ORG };

export function renderAll() {
  return Object.fromEntries(Object.entries(DIAGRAMS).map(([name, spec]) => [`flow-${name}.svg`, buildDiagram(spec)]));
}

/** True when started directly, also through a symlink or a short Windows path (see the shipped scripts). */
function startedDirectly() {
  try {
    return realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (process.argv[1] && startedDirectly()) {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [file, svg] of Object.entries(renderAll())) {
    writeFileSync(join(OUT_DIR, file), svg);
    console.log(`wrote docs/diagrams/${file} (${svg.length} bytes)`);
  }
}
