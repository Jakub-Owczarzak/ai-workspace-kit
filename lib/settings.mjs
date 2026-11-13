// Merges the kit's keys into .claude/settings.json without disturbing anything the user wrote. Nothing is
// replaced: a key the user already set to another value is left alone and reported. A file that is not strict
// JSON (comments, trailing commas) is never rewritten, because rewriting would drop the user's comments.

export const GUARD_COMMAND = 'node "$CLAUDE_PROJECT_DIR/scripts/test-edit-guard.mjs"';
const GUARD_MARKER = 'test-edit-guard.mjs';
const GUARD_MATCHER = 'Edit|Write|MultiEdit';
// The reviewer guard keeps the reviewer subagent read-only. It is a settings hook, not a hook in the agent's own
// frontmatter, because Claude Code skips a project agent's frontmatter hooks in a folder it does not trust.
export const REVIEWER_GUARD_COMMAND = 'node "$CLAUDE_PROJECT_DIR/scripts/reviewer-bash-guard.mjs"';
const REVIEWER_GUARD_MARKER = 'reviewer-bash-guard.mjs';
const REVIEWER_GUARD_MATCHER = 'Bash';

/** True when a PreToolUse entry already runs a command containing `marker` (the kit's, or one the project wired itself). */
function hasPreToolUseHook(object, marker) {
  const entries = object.hooks?.PreToolUse;
  return Array.isArray(entries) && entries.some((entry) => (entry.hooks ?? []).some((hook) => String(hook.command ?? '').includes(marker)));
}

/** Appends one PreToolUse entry, keeping every entry already there. */
function addPreToolUseHook(object, matcher, command) {
  const entries = object.hooks?.PreToolUse;
  object.hooks = { ...(object.hooks ?? {}) };
  object.hooks.PreToolUse = [...(Array.isArray(entries) ? entries : []), { matcher, hooks: [{ type: 'command', command }] }];
}

/** Removes the PreToolUse entry that is exactly the one the kit wrote (same matcher, one hook, same command). Returns true if one went. */
function removePreToolUseHook(object, matcher, command) {
  if (!Array.isArray(object.hooks?.PreToolUse)) return false;
  const before = object.hooks.PreToolUse.length;
  object.hooks.PreToolUse = object.hooks.PreToolUse.filter(
    (entry) => !(entry.matcher === matcher && (entry.hooks ?? []).length === 1 && String(entry.hooks[0].command ?? '') === command)
  );
  const removed = object.hooks.PreToolUse.length < before;
  if (object.hooks.PreToolUse.length === 0) delete object.hooks.PreToolUse;
  if (Object.keys(object.hooks).length === 0) delete object.hooks;
  return removed;
}

/** The indentation the file already uses, so the rewrite does not reformat the whole file. */
function detectIndent(text) {
  const match = text.match(/^\{\r?\n([ \t]+)"/);
  return match ? match[1] : 2;
}

/**
 * Pure merge. `wants` = { planMode, guardHook, reviewerGuard }. Returns { object, changes, skipped }, where `changes` lists
 * what was added and `skipped` lists what the user already set differently.
 */
export function mergeSettings(settings, wants) {
  const object = structuredClone(settings);
  const changes = [];
  const skipped = [];
  // Exactly which keys THIS call added, so an uninstall can remove those and nothing else.
  const added = { defaultMode: false, guardHook: false, reviewerGuard: false };

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

  if (wants.guardHook && !hasPreToolUseHook(object, GUARD_MARKER)) {
    addPreToolUseHook(object, GUARD_MATCHER, GUARD_COMMAND);
    changes.push('hooks.PreToolUse: test-edit-guard');
    added.guardHook = true;
  }

  if (wants.reviewerGuard && !hasPreToolUseHook(object, REVIEWER_GUARD_MARKER)) {
    addPreToolUseHook(object, REVIEWER_GUARD_MATCHER, REVIEWER_GUARD_COMMAND);
    changes.push('hooks.PreToolUse: reviewer-guard');
    added.reviewerGuard = true;
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
 * The reverse of mergeSettings, pure. `owned` = { defaultMode, guardHook, reviewerGuard }: only the keys the kit added are removed.
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

  if (owned.guardHook && removePreToolUseHook(object, GUARD_MATCHER, GUARD_COMMAND)) removed.push('hooks.PreToolUse: test-edit-guard');
  if (owned.reviewerGuard && removePreToolUseHook(object, REVIEWER_GUARD_MATCHER, REVIEWER_GUARD_COMMAND)) removed.push('hooks.PreToolUse: reviewer-guard');
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
