/** Точное зеркало data/scripts/build.py: slugify(page_id) = clean(page_id) + "~" */
export function slugify(pageId: string): string {
  return `${pageId.replace(/[^A-Za-z0-9_.-]/g, '_')}~`
}
