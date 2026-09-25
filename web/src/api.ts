import { slugify } from './utils/slug'

const DATA_BASE = '/data'

const cache = new Map<string, Promise<unknown>>()

function load<T>(path: string, parse: (res: Response) => Promise<T>): Promise<T> {
  let p = cache.get(path)
  if (!p) {
    p = fetch(`${DATA_BASE}/${path}`).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${String(res.status)} for ${path}`)
      return parse(res)
    })
    cache.set(path, p)
    p.catch(() => cache.delete(path))
  }
  return p as Promise<T>
}

export function loadJson<T>(path: string): Promise<T> {
  return load(path, (res) => res.json() as Promise<T>)
}

export function loadText(path: string): Promise<string> {
  return load(path, (res) => res.text())
}

export function revisionFile(pageId: string, slug?: string): string {
  const revisionSlug = slug === undefined || slug === '' ? slugify(pageId) : slug
  return `revisions/${revisionSlug}.json`
}
