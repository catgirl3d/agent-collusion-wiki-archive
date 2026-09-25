import { describe, expect, it } from 'vitest'
import { diffLines } from './diff'

describe('diffLines', () => {
  it('returns an empty array when strings are equal', () => {
    expect(diffLines('', '')).toEqual([])
    expect(diffLines('single line', 'single line')).toEqual([])
    expect(diffLines('line 1\nline 2\nline 3', 'line 1\nline 2\nline 3')).toEqual([])
  })

  it('handles pure append with context prefix', () => {
    const before = 'alpha\nbeta'
    const after = 'alpha\nbeta\ngamma\ndelta'
    const result = diffLines(before, after)

    expect(result).toEqual([
      { kind: 'ctx', text: 'alpha' },
      { kind: 'ctx', text: 'beta' },
      { kind: 'add', text: 'gamma' },
      { kind: 'add', text: 'delta' },
    ])
  })

  it('handles pure deletion with context prefix', () => {
    const before = 'alpha\nbeta\ngamma\ndelta'
    const after = 'alpha\nbeta'
    const result = diffLines(before, after)

    expect(result).toEqual([
      { kind: 'ctx', text: 'alpha' },
      { kind: 'ctx', text: 'beta' },
      { kind: 'del', text: 'gamma' },
      { kind: 'del', text: 'delta' },
    ])
  })

  it('limits context to 3 lines before and after a middle replacement', () => {
    const before = [
      'ctx1',
      'ctx2',
      'ctx3',
      'ctx4',
      'ctx5',
      'old-value',
      'suf1',
      'suf2',
      'suf3',
      'suf4',
      'suf5',
    ].join('\n')

    const after = [
      'ctx1',
      'ctx2',
      'ctx3',
      'ctx4',
      'ctx5',
      'new-value',
      'suf1',
      'suf2',
      'suf3',
      'suf4',
      'suf5',
    ].join('\n')

    const result = diffLines(before, after)

    expect(result).toEqual([
      { kind: 'ctx', text: 'ctx3' },
      { kind: 'ctx', text: 'ctx4' },
      { kind: 'ctx', text: 'ctx5' },
      { kind: 'del', text: 'old-value' },
      { kind: 'add', text: 'new-value' },
      { kind: 'ctx', text: 'suf1' },
      { kind: 'ctx', text: 'suf2' },
      { kind: 'ctx', text: 'suf3' },
    ])
  })

  it('includes all available context when fewer than 3 lines exist', () => {
    const before = 'header\nold\nfooter'
    const after = 'header\nnew\nfooter'
    const result = diffLines(before, after)

    expect(result).toEqual([
      { kind: 'ctx', text: 'header' },
      { kind: 'del', text: 'old' },
      { kind: 'add', text: 'new' },
      { kind: 'ctx', text: 'footer' },
    ])
  })

  it('returns fallback summary markers when modified lines exceed 600', () => {
    const before = Array.from({ length: 650 }, (_, i) => `old line ${String(i)}`).join('\n')
    const after = Array.from({ length: 650 }, (_, i) => `new line ${String(i)}`).join('\n')

    const result = diffLines(before, after)

    expect(result).toEqual([
      { kind: 'del', text: '... [650 lines modified] ...' },
      { kind: 'add', text: '... [650 lines modified] ...' },
    ])
  })

  it('strips common prefix and suffix so localized changes in large files avoid the 600-line fallback', () => {
    const prefix = Array.from({ length: 500 }, (_, i) => `common prefix line ${String(i)}`)
    const suffix = Array.from({ length: 500 }, (_, i) => `common suffix line ${String(i)}`)

    const before = [...prefix, 'original middle', ...suffix].join('\n')
    const after = [...prefix, 'updated middle', ...suffix].join('\n')

    const result = diffLines(before, after)

    expect(result).toHaveLength(8)
    expect(result).toEqual([
      { kind: 'ctx', text: 'common prefix line 497' },
      { kind: 'ctx', text: 'common prefix line 498' },
      { kind: 'ctx', text: 'common prefix line 499' },
      { kind: 'del', text: 'original middle' },
      { kind: 'add', text: 'updated middle' },
      { kind: 'ctx', text: 'common suffix line 0' },
      { kind: 'ctx', text: 'common suffix line 1' },
      { kind: 'ctx', text: 'common suffix line 2' },
    ])
  })

  it('handles complete replacement of lines', () => {
    const before = 'foo\nbar'
    const after = 'baz\nqux'
    const result = diffLines(before, after)

    expect(result).toEqual([
      { kind: 'del', text: 'foo' },
      { kind: 'del', text: 'bar' },
      { kind: 'add', text: 'baz' },
      { kind: 'add', text: 'qux' },
    ])
  })
})
