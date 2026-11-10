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
  // Exactly which keys THIS call added, so an uninstall can remove those and nothing else.
  const added = { defaultMode: false, guardHook: false };

  if (wants.planMode) {
    const current = object.permissions?.defaultMode;
    if (current === undefined) {
      object.permissions = { ...(object.permissions ?? {}), defaultMode: 'plan' };
      changes.push('permissions.defaultMode = "plan"');
      added.defaultMode = true;
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
      added.guardHook = true;
    }
  }
  return { object, changes, skipped, added };
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
  const { object, changes, skipped, added } = mergeSettings(parsed, wants);
  if (changes.length === 0) return { text: existingText, changes, skipped, added };
  const indent = existingText ? detectIndent(existingText) : 2;
  return { text: JSON.stringify(object, null, indent) + '\n', changes, skipped, added };
}

/**
 * The reverse of mergeSettings, pure. `owned` = { defaultMode, guardHook }: only the keys the kit added are removed.
 * defaultMode is removed only while it still says "plan" (a value you changed since is yours). Containers the kit
 * created and that are now empty go too. Returns { object, removed }.
 */
export function removeKitSettings(settings, owned) {
  const object = structuredClone(settings);
  const removed = [];

  if (owned.defaultMode && object.permissions?.defaultMode === 'plan') {
    delete object.permissions.defaultMode;
    removed.push('permissions.defaultMode');
    if (Object.keys(object.permissions).length === 0) delete object.permissions;
  }

  if (owned.guardHook && Array.isArray(object.hooks?.PreToolUse)) {
    const before = object.hooks.PreToolUse.length;
    object.hooks.PreToolUse = object.hooks.PreToolUse.filter(
      (entry) =>
        !(entry.matcher === GUARD_MATCHER && (entry.hooks ?? []).length === 1 && String(entry.hooks[0].command ?? '') === GUARD_COMMAND)
    );
    if (object.hooks.PreToolUse.length < before) removed.push('hooks.PreToolUse: test-edit-guard');
    if (object.hooks.PreToolUse.length === 0) delete object.hooks.PreToolUse;
    if (Object.keys(object.hooks).length === 0) delete object.hooks;
  }
  return { object, removed };
}

/** Text in, text out. Returns { text, removed } or { error } when the file cannot be edited safely. */
export function removeKitSettingsText(existingText, owned) {
  let parsed;
  try {
    parsed = JSON.parse(existingText);
  } catch (error) {
    return { error: `not strict JSON (${error.message}); remove the kit's keys by hand so comments are not lost` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'the top level is not a JSON object' };
  const { object, removed } = removeKitSettings(parsed, owned);
  if (removed.length === 0) return { text: existingText, removed };
  const indent = detectIndent(existingText);
  return { text: JSON.stringify(object, null, indent) + '\n', removed, empty: Object.keys(object).length === 0 };
}
