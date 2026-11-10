// Merges the kit's keys into .claude/settings.json without disturbing anything the user wrote. Nothing is
// replaced: a key the user already set to another value is left alone and reported. A file that is not strict
// JSON (comments, trailing commas) is never rewritten, because rewriting would drop the user's comments.

export const GUARD_COMMAND = 'node "$CLAUDE_PROJECT_DIR/scripts/test-edit-guard.mjs"';
const GUARD_MARKER = 'test-edit-guard.mjs';
const GUARD_MATCHER = 'Edit|Write|MultiEdit';

/** The indentation the file already uses, so the rewrite does not reformat the whole file. */
function detectIndent(text) {
  const match = text.match(/^\{\r?\n([ \t]+)"/);
  return match ? match[1] : 2;
}

/**
 * Pure merge. `wants` = { planMode, guardHook }. Returns { object, changes, skipped }, where `changes` lists
 * what was added and `skipped` lists what the user already set differently.
 */
export function mergeSettings(settings, wants) {
  const object = structuredClone(settings);
  const changes = [];
  const skipped = [];

  if (wants.planMode) {
    const current = object.permissions?.defaultMode;
    if (current === undefined) {
      object.permissions = { ...(object.permissions ?? {}), defaultMode: 'plan' };
      changes.push('permissions.defaultMode = "plan"');
    } else if (current !== 'plan') {
      skipped.push(`permissions.defaultMode is already "${current}"; left as it is`);
    }
  }

  if (wants.guardHook) {
    const entries = object.hooks?.PreToolUse;
    const present =
      Array.isArray(entries) &&
      entries.some((entry) => (entry.hooks ?? []).some((hook) => String(hook.command ?? '').includes(GUARD_MARKER)));
    if (!present) {
      object.hooks = { ...(object.hooks ?? {}) };
      object.hooks.PreToolUse = [
        ...(Array.isArray(entries) ? entries : []),
        { matcher: GUARD_MATCHER, hooks: [{ type: 'command', command: GUARD_COMMAND }] },
      ];
      changes.push('hooks.PreToolUse: test-edit-guard');
    }
  }
  return { object, changes, skipped };
}

/** Text in, text out. Returns { text, changes, skipped } or { error } when the file cannot be edited safely. */
export function mergeSettingsText(existingText, wants) {
  let parsed = {};
  if (existingText !== null && existingText.trim() !== '') {
    try {
      parsed = JSON.parse(existingText);
    } catch (error) {
      return { error: `not strict JSON (${error.message}); add the keys by hand so comments are not lost` };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'the top level is not a JSON object' };
    }
  }
  const { object, changes, skipped } = mergeSettings(parsed, wants);
  if (changes.length === 0) return { text: existingText, changes, skipped };
  const indent = existingText ? detectIndent(existingText) : 2;
  return { text: JSON.stringify(object, null, indent) + '\n', changes, skipped };
}
