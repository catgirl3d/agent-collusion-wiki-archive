export type LruCache<K, V> = {
  get(key: K): V | undefined
  set(key: K, value: V): void
  clear(): void
  readonly size: number
}

export function createLruCache<K, V>(capacity: number): LruCache<K, V> {
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error('capacity must be a positive integer')
  const entries = new Map<K, V>()
  return {
    get(key: K): V | undefined {
      const value = entries.get(key)
      if (value === undefined) return undefined
      entries.delete(key)
      entries.set(key, value)
      return value
    },
    set(key: K, value: V): void {
      entries.delete(key)
      entries.set(key, value)
      if (entries.size > capacity) {
        const oldest = entries.keys().next()
        if (!oldest.done) entries.delete(oldest.value)
      }
    },
    clear(): void {
      entries.clear()
    },
    get size(): number {
      return entries.size
    },
  }
}
