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
})
