// Kit development only (not shipped). Draws the workflow diagrams as SVG files in docs/diagrams/, in the style of a
// boxed pipeline: a box per stage with a title and a subtitle, who acts on it, whether something blocks there, a
// note above, and colored loops for the ways back.
//
//   node scripts/make-flow-diagrams.mjs     writes docs/diagrams/flow-solo|team|org|tdd.svg
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
  solo: '#6e7681',
  team: '#a371f7',
  org: '#db61a2',
  off: '#57606a',
};
const FONT = "'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif";

// Geometry. The viewBox is 1200 wide so the text stays readable when GitHub scales it to the page.
const WIDTH = 1200;
const LEFT = 62;
const RIGHT = 40;
const BOX_H = 84;
const BOX_Y = 196;
const LOOP_TOP = BOX_Y + BOX_H;
const DEFAULT_HEIGHT = 620;

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

/** Where the boxes go for a pipeline of `count` stages, and how much text fits above and inside them. */
export function layoutFor(count) {
  const boxW = count <= 6 ? 150 : 116;
  const step = (WIDTH - LEFT - RIGHT - boxW) / (count - 1);
  return {
    count,
    boxW,
    step,
    noteChars: Math.floor((step - 8) / 6.4),
    subChars: Math.floor((boxW - 12) / 6.2),
    centerX: (index) => LEFT + index * step + boxW / 2,
  };
}

function chip(x, y, label, color, textColor = COLOR.page) {
  const width = Math.round(label.length * 6.6 + 12);
  return {
    width,
    svg:
      `<rect x="${x}" y="${y}" width="${width}" height="17" rx="8.5" fill="${color}"/>` +
      `<text x="${x + width / 2}" y="${y + 12.2}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${textColor}">${label}</text>`,
  };
}

function stageSvg(index, stage, lay) {
  const x = LEFT + index * lay.step;
  const parts = [];
  const mid = x + lay.boxW / 2;

  // The note above the box: what happens here and who decides.
  const noteLines = wrap(stage.note, lay.noteChars);
  const noteTop = BOX_Y - 22 - noteLines.length * 15;
  noteLines.forEach((line, i) => {
    parts.push(`<text x="${mid}" y="${noteTop + 11 + i * 15}" text-anchor="middle" font-size="12" fill="${COLOR.dim}">${escapeXml(line)}</text>`);
  });

  // The box. Red border where something blocks; dashed where the step happens only in some cases.
  const border = stage.hard ? COLOR.hard : COLOR.line;
  const dash = stage.conditional ? ' stroke-dasharray="6 4"' : '';
  parts.push(
    `<rect x="${x}" y="${BOX_Y}" width="${lay.boxW}" height="${BOX_H}" rx="12" fill="${COLOR.box}" stroke="${border}" stroke-width="${stage.hard ? 2 : 1.4}"${dash}/>`
  );
  parts.push(`<text x="${mid}" y="${BOX_Y + 38}" text-anchor="middle" font-size="16" font-weight="700" fill="${COLOR.text}">${escapeXml(stage.title)}</text>`);
  wrap(stage.sub, lay.subChars).forEach((line, i) => {
    parts.push(`<text x="${mid}" y="${BOX_Y + 56 + i * 14}" text-anchor="middle" font-size="12" fill="${COLOR.dim}">${escapeXml(line)}</text>`);
  });

  // Who acts: chips on the top border. Where something blocks: a red HARD chip in the bottom-right corner, clear of
  // the loops, which leave from the middle of a box and arrive to the left of the middle of the target.
  let cursor = x + 8;
  for (const actor of stage.actors) {
    const color = { YOU: COLOR.you, AI: COLOR.ai, RUN: COLOR.run }[actor];
    const made = chip(cursor, BOX_Y - 9, actor, color);
    parts.push(made.svg);
    cursor += made.width + 5;
  }
  if (stage.hard) {
    const hardWidth = chip(0, 0, 'HARD', COLOR.hard).width;
    parts.push(chip(x + lay.boxW - 8 - hardWidth, BOX_Y + BOX_H - 9, 'HARD', COLOR.hard, '#ffffff').svg);
  }

  // The arrow into the next stage.
  if (index < lay.count - 1) {
    const y = BOX_Y + BOX_H / 2;
    parts.push(`<line x1="${x + lay.boxW + 3}" y1="${y}" x2="${x + lay.step - 4}" y2="${y}" stroke="${COLOR.dim}" stroke-width="1.6" marker-end="url(#arrow)"/>`);
  }
  return parts.join('\n');
}

/** The arrow that enters the first stage from the left edge ("you ask"). */
function entrySvg(label) {
  const y = BOX_Y + BOX_H / 2;
  return (
    `<line x1="12" y1="${y}" x2="${LEFT - 4}" y2="${y}" stroke="${COLOR.you}" stroke-width="1.8" marker-end="url(#arrow-entry)"/>\n` +
    `<text x="12" y="${y - 8}" font-size="11.5" font-weight="700" fill="${COLOR.you}">${escapeXml(label)}</text>`
  );
}

/** A way back: down from one box, along a line, and up into another box. */
function loopSvg(loop, lay) {
  const fromX = lay.centerX(loop.from);
  const toX = lay.centerX(loop.to ?? 2) + loop.arriveOffset;
  // The label starts right of the arrows arriving at the target, and stops before the next loop's vertical line.
  const labelX = lay.centerX(loop.to ?? 2) + Math.max(24, loop.arriveOffset + 14);
  const maxChars = Math.max(18, Math.floor(((loop.limitX ?? WIDTH - 40) - labelX - 10) / 6.5));
  const labelSvg = wrap(loop.label, maxChars)
    .map((line, i) => `<text x="${labelX}" y="${loop.y + 17 + i * 15}" font-size="12.5" fill="${loop.color}">${escapeXml(line)}</text>`)
    .join('\n');
  return (
    `<path d="M ${fromX} ${LOOP_TOP + 2} V ${loop.y} H ${toX} V ${LOOP_TOP + 4}" fill="none" stroke="${loop.color}" stroke-width="2" stroke-linejoin="round" marker-end="url(#arrow-${loop.name})"/>\n` +
    labelSvg
  );
}

const marker = (id, color) =>
  `<marker id="${id}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/></marker>`;

/** A table under the pipeline: one row per profile, saying what that profile changes. */
function panelSvg(panel) {
  const parts = [`<text x="37" y="${panel.y}" font-size="15" font-weight="700" fill="${COLOR.text}">${escapeXml(panel.title)}</text>`];
  let y = panel.y + 18;
  for (const row of panel.rows) {
    const made = chip(37, y, row.label, COLOR[row.label.toLowerCase()], '#ffffff');
    parts.push(made.svg);
    const lines = wrap(row.text, 142);
    lines.forEach((line, i) => {
      parts.push(`<text x="${37 + made.width + 12}" y="${y + 13 + i * 16}" font-size="12.5" fill="${COLOR.dim}">${escapeXml(line)}</text>`);
    });
    y += Math.max(26, lines.length * 16 + 12);
  }
  return parts.join('\n');
}

function legendSvg(y, footer) {
  const items = [
    { label: 'YOU', color: COLOR.you, text: 'a person decides or acts: approves, asks, pushes, merges' },
    { label: 'AI', color: COLOR.ai, text: 'the assistant, working under the rules and skills' },
    { label: 'RUN', color: COLOR.run, text: 'a script, a git hook or a CI job' },
    { label: 'HARD', color: COLOR.hard, text: 'something blocks (only where the hook or tool is installed)' },
    { dashed: true, text: 'dashed box: happens only in some cases (the note says when)' },
  ];
  const parts = [];
  items.forEach((item, i) => {
    const x = 37 + (i % 2) * 560;
    const rowY = y + Math.floor(i / 2) * 26;
    if (item.dashed) {
      parts.push(`<rect x="${x}" y="${rowY}" width="34" height="17" rx="6" fill="none" stroke="${COLOR.dim}" stroke-width="1.4" stroke-dasharray="4 3"/>`);
      parts.push(`<text x="${x + 44}" y="${rowY + 13}" font-size="12.5" fill="${COLOR.dim}">${escapeXml(item.text)}</text>`);
      return;
    }
    const made = chip(x, rowY, item.label, item.color, item.label === 'HARD' ? '#ffffff' : COLOR.page);
    parts.push(made.svg);
    parts.push(`<text x="${x + made.width + 10}" y="${rowY + 13}" font-size="12.5" fill="${COLOR.dim}">${escapeXml(item.text)}</text>`);
  });
  parts.push(`<text x="37" y="${y + 92}" font-size="12.5" fill="${COLOR.dim}">${escapeXml(footer)}</text>`);
  return parts.join('\n');
}

const FOOTER_PROFILE =
  'In no profile does anything push, open a pull request or merge by itself. The profile changes how much a machine blocks, not whether a person decides.';

export function buildDiagram(spec) {
  const height = spec.height ?? DEFAULT_HEIGHT;
  const lay = layoutFor(spec.stages.length);
  const markers =
    marker('arrow', COLOR.dim) + marker('arrow-entry', COLOR.you) + spec.loops.map((loop) => marker(`arrow-${loop.name}`, loop.color)).join('');
  const stages = spec.stages.map((stage, index) => stageSvg(index, stage, lay)).join('\n');
  const loops = spec.loops.map((loop) => loopSvg(loop, lay)).join('\n');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}" role="img" ` +
    `aria-label="${escapeXml(spec.ariaLabel)}" font-family="${FONT}">\n` +
    `<title>${escapeXml(spec.ariaLabel)}</title>\n` +
    `<defs>${markers}</defs>\n` +
    `<rect x="1" y="1" width="${WIDTH - 2}" height="${height - 2}" rx="16" fill="${COLOR.page}" stroke="${COLOR.line}" stroke-width="2"/>\n` +
    `<text x="37" y="48" font-size="24" font-weight="700" fill="${COLOR.text}">${escapeXml(spec.title)}</text>\n` +
    `<text x="37" y="72" font-size="14" fill="${COLOR.dim}">${escapeXml(spec.subtitle)}</text>\n` +
    `${spec.entry ? entrySvg(spec.entry) + '\n' : ''}${stages}\n${loops}\n${spec.panel ? panelSvg(spec.panel) + '\n' : ''}` +
    `${legendSvg(height - 136, spec.footer ?? FOOTER_PROFILE)}\n</svg>\n`
  );
}

// ---- the profile diagrams ------------------------------------------------------------------------------------

const lay8 = layoutFor(8);
const PROFILE_LOOPS = [
  { name: 'fail', from: 3, to: 2, y: LOOP_TOP + 44, arriveOffset: 0, color: COLOR.orange, limitX: lay8.centerX(4), label: 'FAIL: the assistant gets the log and fixes it' },
  { name: 'changes', from: 4, to: 2, y: LOOP_TOP + 92, arriveOffset: -17, color: COLOR.blue, limitX: lay8.centerX(5), label: 'CHANGES: a blocking finding is fixed, then reviewed again' },
  { name: 'hook', from: 5, to: 2, y: LOOP_TOP + 140, arriveOffset: -34, color: COLOR.hard, limitX: WIDTH - 40, label: 'HOOK FAILS: the commit is blocked, fix and commit again' },
];

const COMMIT = { title: 'Commit', sub: 'hook gate', actors: ['YOU', 'RUN'], hard: true };
const PUSH = { title: 'Push', sub: 'hook gate', actors: ['YOU', 'RUN'], hard: true };
const VERIFY = { title: 'Verify', sub: 'lint, types, whole suite', actors: ['AI'], note: 'the assistant runs the whole suite and shows the real output. Always, even with tests.tdd off' };
const PULL_REQUEST = { title: 'Pull request', sub: 'drafted, merged by you', actors: ['AI', 'YOU', 'RUN'] };

const SOLO = {
  ariaLabel: 'Solo workflow: plan, test first for bug fixes, build, verify, review, commit, push and pull request, with who acts and where something blocks',
  title: 'Solo: one owner who reads every diff',
  subtitle: 'Light: advice and warnings. You approve the plan, ask for the commit, push and merge. Only the hooks you install block.',
  entry: 'you ask',
  stages: [
    { title: 'Plan', sub: 'Intent Anchor', actors: ['AI', 'YOU'], note: 'you approve the anchor, the bucket map and each bucket plan. Routine work is exempt' },
    { title: 'Test first', sub: 'bug fixes, TDD buckets', actors: ['AI'], conditional: true, note: 'a bug fix starts with a failing test, shown failing. New logic only if the bucket says TDD: yes' },
    { title: 'Build', sub: 'makes the test pass', actors: ['AI'], note: 'router and always-on rules. Change the code, never the test. Test guard is off' },
    VERIFY,
    { title: 'Review', sub: 'advisory', actors: ['AI'], note: 'reviewer subagent on the staged change. You read the diff too' },
    { ...COMMIT, note: 'you ask for it. Hook: lint, types, tests. Docs check only warns. You give the changelog line' },
    { ...PUSH, note: 'you push, never the assistant. Protected branch refused. Review: a reminder only' },
    { ...PULL_REQUEST, note: 'assistant drafts the text. You open it, CI runs, you merge. You merge the release PR' },
  ],
  loops: PROFILE_LOOPS,
};

const TEAM = {
  ariaLabel: 'Team workflow: plan mode, test first, build with the fix-mode guard, verify, review, commit, push and pull request, with who acts and where something blocks',
  title: 'Team: a few developers on a shared repository',
  subtitle: 'Solo, plus plan mode, test-first for new logic too, and a guard that protects existing tests during a bug fix.',
  entry: 'you ask',
  stages: [
    { title: 'Plan', sub: 'plan mode', actors: ['AI', 'YOU'], hard: true, note: 'you approve anchor, buckets and each plan. Nothing is edited until you accept the plan' },
    { title: 'Test first', sub: 'red: must fail first', actors: ['AI'], hard: true, note: 'bug fixes and new logic start with a failing test. Fix mode: start, write tests, lock' },
    { title: 'Build', sub: 'green: code only', actors: ['AI'], hard: true, note: 'the guard refuses edits to existing tests. A test that looks wrong: stop and ask you' },
    VERIFY,
    { title: 'Review', sub: 'advisory', actors: ['AI'], note: 'reviewer subagent on the staged change. You read the diff too' },
    { ...COMMIT, note: 'you ask for it. Hook: lint, types, tests. Docs check only warns. You give the changelog line' },
    { ...PUSH, note: 'you push, never the assistant. Protected branch refused. Review: a reminder only' },
    { ...PULL_REQUEST, note: 'assistant drafts the text. You open it, CI runs, you merge. You merge the release PR' },
  ],
  loops: PROFILE_LOOPS,
};

const ORG = {
  ariaLabel: 'Org workflow: success measurements, plan mode, test first, build with the guard, required review record, strict docs check and push gate, with who acts and where something blocks',
  title: 'Org: many developers, policies that must hold',
  subtitle: 'Team, plus success measurements, a docs check that blocks, and a review record the push hook requires.',
  entry: 'you ask',
  stages: [
    { title: 'Plan', sub: 'anchor + measures', actors: ['AI', 'YOU'], hard: true, note: 'anchor plus success measurements. Plan mode is the default: you accept before any edit' },
    { title: 'Test first', sub: 'red: must fail first', actors: ['AI'], hard: true, note: 'bug fixes and new logic start with a failing test. Fix mode: start, write tests, lock' },
    { title: 'Build', sub: 'green: code only', actors: ['AI'], hard: true, note: 'the guard refuses edits to existing tests. A test that looks wrong: stop and ask you' },
    VERIFY,
    { title: 'Review', sub: 'required', actors: ['AI'], note: 'the assistant must run the reviewer and record the result for these exact contents' },
    { ...COMMIT, note: 'you ask for it. Hook: lint, types, tests. Docs check blocks until AGENTS.md is updated' },
    { ...PUSH, note: 'you push. Protected branch refused. No clean review record: refused' },
    { ...PULL_REQUEST, note: 'assistant drafts the text. Your PR rules and colleagues apply. You merge, then the release PR' },
  ],
  loops: PROFILE_LOOPS,
};

// ---- the test-first and bug-fix path ---------------------------------------------------------------------------

const lay6 = layoutFor(6);
const TDD = {
  ariaLabel: 'Test-first and bug-fix path: reproduce as a failing test, show it failing, lock the tests, change only the code, show it passing, stop fix mode',
  title: 'Test first and bug fixes: the test comes before the code',
  subtitle: 'A failing test is the proof. It is written first and shown failing; then only the code changes until it passes.',
  height: 760,
  stages: [
    { title: 'Reproduce', sub: 'as a failing test', actors: ['AI'], note: 'bug fix: reproduce it as a test. New logic: one test per acceptance criterion' },
    { title: 'Show it failing', sub: 'for the right reason', actors: ['AI'], note: 'run it and show the failure. A test that fails for the wrong reason proves nothing' },
    { title: 'Lock', sub: 'fix mode: start, lock', actors: ['RUN'], hard: true, conditional: true, note: 'tests.guard on (team, org): from here the hook refuses edits to existing test files' },
    { title: 'Change the code', sub: 'least code to pass', actors: ['AI'], note: 'code only. Never edit, skip or weaken the test to get to green' },
    { title: 'Show it passing', sub: 'then the whole suite', actors: ['AI'], note: 'run the test again and show it passing, then run every test and show that too' },
    { title: 'Stop fix mode', sub: 'tests unlocked', actors: ['RUN'], conditional: true, note: 'refactor with the tests green, then verify, review and commit as usual' },
  ],
  loops: [
    { name: 'wrong', from: 3, to: 0, y: LOOP_TOP + 44, arriveOffset: 0, color: COLOR.you, limitX: lay6.centerX(3) + 60, label: 'TEST LOOKS WRONG: the assistant stops, says why, and YOU decide. A changed test starts again here' },
    { name: 'again', from: 4, to: 3, y: LOOP_TOP + 100, arriveOffset: 22, color: COLOR.orange, limitX: WIDTH - 40, label: 'STILL FAILING: keep changing the code, not the test' },
  ],
  panel: {
    y: 410,
    title: 'What each profile changes',
    rows: [
      { label: 'SOLO', text: 'tests.tdd = bugs: a bug fix always starts with a failing test. New logic is test-first only in a bucket the plan marks TDD: yes. The guard is off: the rule says never weaken a test, but nothing blocks it.' },
      { label: 'TEAM', text: 'tests.tdd = on: bug fixes and all new logic start with a failing test. The guard is on: in fix mode the hook refuses edits to existing test files (HARD).' },
      { label: 'ORG', text: 'Same test-first rules as team. What org adds is around it: success measurements in the plan, a docs check that blocks the commit, and a review record the push hook requires.' },
      { label: 'OFF', text: 'tests.tdd = off (an override, no profile uses it): no test-first rule, so the Test first stage is skipped. Tests are NOT gone from the flow: the assistant still runs the whole suite in Verify, the commit gate says never to commit with a failing test, and the pre-commit hook runs the tests.' },
    ],
  },
  footer: 'Never skip, delete, weaken or loosen a failing test to get to green. If a test looks wrong, the assistant stops and asks you.',
};

export const DIAGRAMS = { solo: SOLO, team: TEAM, org: ORG, tdd: TDD };

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
