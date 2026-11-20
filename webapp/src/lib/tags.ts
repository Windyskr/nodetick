/**
 * Tags are case-insensitive: the server keys a tag by its lowercased name
 * (`#Work` and `#work` are one tag, listed as name "work", label "Work"),
 * while a task keeps the text as it was typed.
 */
export function tagKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Whether the task carries the tag, whatever case either side uses. */
export function hasTag(task: { tags: string[] }, name: string): boolean {
  const key = tagKey(name);
  return task.tags.some((tag) => tagKey(tag) === key);
}

/** Merge tag lists, keeping the first spelling of each tag. */
export function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  return tags.filter((tag) => {
    const key = tagKey(tag);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Whether a task belongs on a tag's page: it has the tag, or (for a parent
 * tag) one of its sub-tags. `tags` is the user's tag list.
 */
export function hasTagOrSubTag(task: { tags: string[] }, name: string, tags: { name: string; parentId: string | null }[]): boolean {
  const key = tagKey(name);
  if (hasTag(task, key)) return true;
  return tags.some((tag) => tag.parentId === key && hasTag(task, tag.name));
}

/** Top-level tags, each followed by its sub-tags, in the list's order. */
export function tagTree<T extends { name: string; parentId: string | null }>(tags: T[]): { tag: T; children: T[] }[] {
  const names = new Set(tags.map((tag) => tag.name));
  // A sub-tag whose parent is gone shows at the top level.
  const roots = tags.filter((tag) => !tag.parentId || !names.has(tag.parentId));
  return roots.map((tag) => ({ tag, children: tags.filter((child) => child.parentId === tag.name && child !== tag) }));
}
