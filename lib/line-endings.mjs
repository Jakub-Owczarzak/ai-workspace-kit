// Line endings of the files the kit edits but does not own (workflow.json, settings.json, package.json). A file that
// uses Windows line endings (CRLF) must stay that way: writing it back with LF would show a change on every line.

/** True when the text's first line break is a CRLF. An empty or missing text counts as LF. */
export function usesCrlf(text) {
  if (typeof text !== 'string') return false;
  const first = text.indexOf('\n');
  return first > 0 && text[first - 1] === '\r';
}

/** `newText` with the line endings of `originalText` (CRLF when the original used it, otherwise unchanged). */
export function matchLineEndings(newText, originalText) {
  return usesCrlf(originalText) ? newText.replace(/\r?\n/g, '\r\n') : newText;
}
