import { slugify } from './utils/slug'
import { createLruCache } from './utils/lru'

const DATA_BASE = '/data'
const CACHE_CAPACITY = 32

const completed = createLruCache<string, Promise<unknown>>(CACHE_CAPACITY)
const inFlight = new Map<string, Promise<unknown>>()

function load<T>(path: string, parse: (res: Response) => Promise<T>): Promise<T> {
  const cached = completed.get(path)
  if (cached) return cached as Promise<T>

  const pending = inFlight.get(path)
  if (pending) return pending as Promise<T>

  const promise = fetch(`${DATA_BASE}/${path}`).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${String(res.status)} for ${path}`)
    return parse(res)
  })
  inFlight.set(path, promise)
  promise.then(
    () => {
      if (inFlight.get(path) === promise) inFlight.delete(path)
      completed.set(path, promise)
    },
    () => {
      if (inFlight.get(path) === promise) inFlight.delete(path)
    },
  )

  return promise
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
