import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NetworkCanvas from './NetworkCanvas'

const cytoscapeMock = vi.fn()
vi.mock('cytoscape', () => ({ default: cytoscapeMock }))

describe('NetworkCanvas', () => {
  beforeEach(() => {
    cytoscapeMock.mockReset()
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn()
      disconnect = vi.fn()
    })
  })

  it('wires graph selections to callbacks and destroys the instance on unmount', async () => {
    const handlers = new Map<string, (event: { target: unknown }) => void>()
    const destroy = vi.fn()
    const instance = {
      on: vi.fn((event: string, selectorOrHandler: string | ((event: { target: unknown }) => void), maybeHandler?: (event: { target: unknown }) => void) => {
        handlers.set(`${event}:${typeof selectorOrHandler === 'string' ? selectorOrHandler : 'canvas'}`, maybeHandler ?? selectorOrHandler as (event: { target: unknown }) => void)
      }),
      destroy,
      elements: () => ({ empty: () => true }),
      add: vi.fn(),
      batch: vi.fn((callback: () => void) => { callback(); }),
      layout: vi.fn(() => ({ run: vi.fn() })),
    }
    cytoscapeMock.mockReturnValue(instance)

    const onNodeSelect = vi.fn()
    const onEdgeSelect = vi.fn()
    const onBackgroundTap = vi.fn()
    const view = render(
      <NetworkCanvas
        networkData={{ nodes: [], edges: [] }}
        layoutName="cose"
        activeAgent="agent-a"
        validatedPair={null}
        selParam={null}
        onNodeSelect={onNodeSelect}
        onEdgeSelect={onEdgeSelect}
        onBackgroundTap={onBackgroundTap}
      />,
    )

    await waitFor(() => { expect(cytoscapeMock).toHaveBeenCalled(); })
    handlers.get('tap:node')?.({ target: { id: () => 'agent-b' } })
    handlers.get('tap:edge')?.({ target: { source: () => ({ id: () => 'agent-a' }), target: () => ({ id: () => 'agent-b' }) } })
    handlers.get('tap:canvas')?.({ target: instance })

    expect(onNodeSelect).toHaveBeenCalledWith('agent-b')
    expect(onEdgeSelect).toHaveBeenCalledWith('agent-a', 'agent-b')
    expect(onBackgroundTap).toHaveBeenCalledTimes(1)

    view.unmount()
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('runs the layout exactly once when mounting with graph data', async () => {
    const layoutSpy = vi.fn(() => ({ run: vi.fn() }))
    const edgesRemoveClass = vi.fn()
    const instance = {
      on: vi.fn(),
      destroy: vi.fn(),
      elements: () => ({ empty: () => false, remove: vi.fn(), removeClass: vi.fn(), not: vi.fn() }),
      edges: () => ({ removeClass: edgesRemoveClass, filter: vi.fn(() => ({ addClass: vi.fn() })) }),
      getElementById: vi.fn(() => ({ length: 0 })),
      add: vi.fn(),
      batch: vi.fn((callback: () => void) => { callback(); }),
      layout: layoutSpy,
    }
    cytoscapeMock.mockReturnValue(instance)
    const graph = { nodes: [{ id: 'agent-a', label: 'agent-a', isCenter: true, wikis: [], revs: 1, pagesCount: 1 }], edges: [] }
    const view = render(<NetworkCanvas networkData={graph} layoutName="cose" activeAgent="agent-a" validatedPair={null} selParam={null} onNodeSelect={vi.fn()} onEdgeSelect={vi.fn()} onBackgroundTap={vi.fn()} />)

    await waitFor(() => { expect(edgesRemoveClass).toHaveBeenCalled(); })
    expect(layoutSpy).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('clears stale elements when the graph changes from non-empty to empty', async () => {
    let hasElements = false
    const remove = vi.fn(() => { hasElements = false })
    const elements = () => ({
      empty: () => !hasElements,
      remove,
      removeClass: vi.fn(),
      not: vi.fn(),
    })
    const instance = {
      on: vi.fn(),
      destroy: vi.fn(),
      elements,
      edges: () => ({ removeClass: vi.fn(), filter: vi.fn(() => ({ addClass: vi.fn() })) }),
      add: vi.fn(() => { hasElements = true }),
      batch: vi.fn((callback: () => void) => { callback(); }),
      layout: vi.fn(() => ({ run: vi.fn() })),
    }
    cytoscapeMock.mockReturnValue(instance)
    const graph = { nodes: [{ id: 'agent-a', label: 'agent-a', isCenter: true, wikis: [], revs: 1, pagesCount: 1 }], edges: [] }
    const view = render(<NetworkCanvas networkData={graph} layoutName="cose" activeAgent="agent-a" validatedPair={null} selParam={null} onNodeSelect={vi.fn()} onEdgeSelect={vi.fn()} onBackgroundTap={vi.fn()} />)

    await waitFor(() => { expect(cytoscapeMock).toHaveBeenCalled(); })
    expect(hasElements).toBe(true)
    view.rerender(<NetworkCanvas networkData={{ nodes: [], edges: [] }} layoutName="cose" activeAgent="agent-a" validatedPair={null} selParam={null} onNodeSelect={vi.fn()} onEdgeSelect={vi.fn()} onBackgroundTap={vi.fn()} />)

    await waitFor(() => { expect(remove).toHaveBeenCalledTimes(1); })
    expect(hasElements).toBe(false)
    view.unmount()
  })
})
