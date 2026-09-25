export interface LruCache<K, V> {
  get(key: K): V | undefined
  set(key: K, value: V): void
  clear(): void
  readonly size: number
}

export function createLruCache<K, V>(
  capacity: number,
  maxCost = Number.POSITIVE_INFINITY,
  costOf: (value: V) => number = () => 1,
): LruCache<K, V> {
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error('capacity must be a positive integer')
  if (maxCost < 1) throw new Error('maxCost must be at least 1')
  const entries = new Map<K, V>()
  let cost = 0

  const remove = (key: K): void => {
    const value = entries.get(key)
    if (value === undefined) return
    entries.delete(key)
    cost -= costOf(value)
  }

  return {
    get(key: K): V | undefined {
      const value = entries.get(key)
      if (value === undefined) return undefined
      entries.delete(key)
      entries.set(key, value)
      return value
    },
    set(key: K, value: V): void {
      remove(key)
      const valueCost = costOf(value)
      if (valueCost > maxCost) return
      entries.set(key, value)
      cost += valueCost
      while (entries.size > capacity || cost > maxCost) {
        const oldest = entries.keys().next()
        if (oldest.done) break
        remove(oldest.value)
      }
    },
    clear(): void {
      entries.clear()
      cost = 0
    },
    get size(): number {
      return entries.size
    },
  }
}
