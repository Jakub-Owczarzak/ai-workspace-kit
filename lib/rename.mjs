// Kit skills are installed as `wk-<name>` so they can never collide with a skill the project already has.
// Every mention of another kit skill inside installed text (a `name`, a /slash command, a path) is
// rewritten to match. Already-prefixed names are left alone, so running twice changes nothing.

export const SKILL_PREFIX = 'wk-';

/** Text from the kit's own folder is not rewritten when it points at the kit, not at an installed skill. */
const KIT_PATH_ENDINGS = ['workspace-kit/skills/', 'KIT>/skills/', 'kit/skills/'];

export function rewriteSkillNames(text, skillNames) {
  if (skillNames.length === 0) return text;
  const pattern = new RegExp(`(?<![\\w-])(${skillNames.map(escapeRegExp).join('|')})(?![\\w-])`, 'g');
  return text.replace(pattern, (name, _group, offset) => {
    const before = text.slice(Math.max(0, offset - 24), offset);
    return KIT_PATH_ENDINGS.some((ending) => before.endsWith(ending)) ? name : SKILL_PREFIX + name;
  });
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Text files whose content may mention skills. Scripts are copied byte-for-byte. */
export const isRewritableText = (fileName) => /\.(md|json|ya?ml|txt)$/i.test(fileName) || fileName === 'pre-commit' || fileName === 'pre-push';
