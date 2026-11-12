// Rules are written for every project, but some passages only matter when an option is installed (the e2e step of the
// commit gate, the factory exception, the design sync). A passage between
//
//   <!-- wk:if skill.figma-sync -->
//   ...
//   <!-- wk:endif -->
//
// is written into the project's rules block only when that option is installed. `!id` means "not installed" and
// `a|b` means "any of them". The marker lines never reach the project. Markers do not nest: a mistake in a rule file
// is an error here (and in the tests), not a half-applied rule.

const OPEN = /^<!-- wk:if (\S+) -->$/;
const CLOSE = /^<!-- wk:endif -->$/;

const conditionHolds = (condition, has) =>
  condition.split('|').some((term) => (term.startsWith('!') ? !has(term.slice(1)) : has(term)));

/** The rule text for a project: sections whose option is not installed are removed, marker lines are removed. */
export function selectSections(text, has) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const kept = [];
  let open = null; // the condition of the section we are inside, or null
  let keeping = true;
  for (const line of lines) {
    const opening = line.match(OPEN);
    if (opening) {
      if (open !== null) throw new Error(`wk:if ${opening[1]} is nested inside wk:if ${open}; sections do not nest`);
      open = opening[1];
      keeping = conditionHolds(open, has);
      continue;
    }
    if (CLOSE.test(line)) {
      if (open === null) throw new Error('wk:endif without a wk:if');
      open = null;
      keeping = true;
      continue;
    }
    if (keeping) kept.push(line);
  }
  if (open !== null) throw new Error(`wk:if ${open} is not closed by a wk:endif`);
  return kept.join('\n').replace(/\n{3,}/g, '\n\n');
}
