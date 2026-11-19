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
