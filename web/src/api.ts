const DATA_BASE = '/data'

const cache = new Map<string, Promise<unknown>>()

export function loadJson<T>(path: string): Promise<T> {
  let p = cache.get(path)
  if (!p) {
    p = fetch(`${DATA_BASE}/${path}`).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`)
      return res.json()
    })
    cache.set(path, p)
    p.catch(() => cache.delete(path))
  }
  return p as Promise<T>
}

export function revisionFile(pageId: string, slug?: string): string {
  return `revisions/${slug || slugify(pageId)}.json`
}

/** Точное зеркало data/scripts/build.py: slugify(page_id) = clean(page_id) + "~" */
export function slugify(pageId: string): string {
  return `${pageId.replace(/[^A-Za-z0-9_.-]/g, '_')}~`
}