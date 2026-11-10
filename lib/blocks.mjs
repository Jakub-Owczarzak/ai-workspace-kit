// Marked blocks: the only way the kit edits a file the user owns. Text between the start and end
// markers belongs to the kit and is replaced on every run; everything outside belongs to the user
// and is never touched. Running twice gives the same file. A block can be removed cleanly.

const MARKERS = {
  html: (kind, id) => `<!-- workspace-kit:${kind} ${id} -->`,
  hash: (kind, id) => `# workspace-kit:${kind} ${id}`,
};

const markersFor = (id, style) => {
  const make = MARKERS[style];
  if (!make) throw new Error(`unknown block style "${style}"`);
  return { start: make('start', id), end: make('end', id) };
};

/** Where the block sits in the text: `null` when absent; throws when only one marker exists. */
function locate(text, id, style) {
  const { start, end } = markersFor(id, style);
  const startAt = text.indexOf(start);
  const endAt = text.indexOf(end);
  if (startAt === -1 && endAt === -1) return null;
  if (startAt === -1 || endAt === -1 || endAt < startAt) {
    throw new Error(`block "${id}" has a start or end marker but not both; fix it by hand before running again`);
  }
  return { startAt, endAt: endAt + end.length, start, end };
}

export function upsertBlock(text, id, body, style = 'html') {
  const { start, end } = markersFor(id, style);
  const block = `${start}\n${body.replace(/\s+$/, '')}\n${end}`;
  const found = locate(text, id, style);
  if (found) return text.slice(0, found.startAt) + block + text.slice(found.endAt);
  if (text.length === 0) return block + '\n';
  const separator = text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  return text + separator + block + '\n';
}

export function removeBlock(text, id, style = 'html') {
  const found = locate(text, id, style);
  if (!found) return text;
  const before = text.slice(0, found.startAt).replace(/\n+$/, '');
  const after = text.slice(found.endAt).replace(/^\n+/, '');
  const joined = [before, after].filter(Boolean).join('\n\n');
  return joined ? joined + '\n' : '';
}

export const hasBlock = (text, id, style = 'html') => locate(text, id, style) !== null;
