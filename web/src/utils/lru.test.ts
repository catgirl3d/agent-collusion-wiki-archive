import { describe, expect, it } from 'vitest'
import { createLruCache } from './lru'

describe('createLruCache', () => {
  it('evicts the least recently used entry beyond capacity', () => {
    const cache = createLruCache<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
    expect(cache.size).toBe(2)
  })

  it('keeps a hit when a later insert needs space', () => {
    const cache = createLruCache<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1)
    cache.set('c', 3)
    expect(cache.get('a')).toBe(1)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe(3)
  })

  it('updates an existing key without growing past capacity', () => {
    const cache = createLruCache<string, number>(1)
    cache.set('a', 1)
    cache.set('a', 2)
    expect(cache.get('a')).toBe(2)
    expect(cache.size).toBe(1)
  })

  it('keeps exactly one entry at capacity 1', () => {
    const cache = createLruCache<string, number>(1)
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.size).toBe(1)
  })

  it('clears all entries', () => {
    const cache = createLruCache<string, number>(4)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get('a')).toBeUndefined()
  })

  it('rejects a non-positive capacity', () => {
    expect(() => createLruCache<string, number>(0)).toThrow('capacity must be a positive integer')
    expect(() => createLruCache<string, number>(1.5)).toThrow('capacity must be a positive integer')
  })

  it('evicts oldest entries when the cost budget is exceeded', () => {
    const cache = createLruCache<string, number[]>(10, 5, (value) => value.length)
    cache.set('a', [1, 2, 3])
    expect(cache.get('a')).toEqual([1, 2, 3])
    cache.set('b', [1, 2, 3])
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toEqual([1, 2, 3])
    expect(cache.size).toBe(1)
  })

  it('does not retain a single entry larger than the budget', () => {
    const cache = createLruCache<string, number[]>(10, 5, (value) => value.length)
    cache.set('a', [1, 2])
    cache.set('big', [1, 2, 3, 4, 5, 6])
    expect(cache.get('big')).toBeUndefined()
    expect(cache.get('a')).toEqual([1, 2])
    expect(cache.size).toBe(1)
  })

  it('keeps the cache within the cost budget after recency updates', () => {
    const cache = createLruCache<string, number[]>(10, 6, (value) => value.length)
    cache.set('a', [1, 2, 3])
    cache.set('b', [1, 2, 3])
    expect(cache.get('a')).toEqual([1, 2, 3])
    cache.set('c', [1, 2, 3])
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toEqual([1, 2, 3])
    expect(cache.get('c')).toEqual([1, 2, 3])
  })
})
