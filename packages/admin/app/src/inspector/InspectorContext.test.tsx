// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { act, screen } from '@testing-library/react'
import { useInspector } from './InspectorContext.tsx'
import { renderAt } from '../test/render.tsx'

function Probe() {
  const i = useInspector()
  return <><span data-testid="id">{i.id ?? 'none'}</span><button onClick={() => i.open('project:p1')}>open</button><button onClick={i.close}>close</button></>
}

describe('InspectorContext', () => {
  it('opens on the page it was opened on, and hides once the path changes', () => {
    const { loc } = renderAt(<Probe />, '/b/projects')
    act(() => screen.getByText('open').click())
    expect(screen.getByTestId('id').textContent).toBe('project:p1')
    act(() => loc.navigate('/b/projects?x=1')) // the same page
    expect(screen.getByTestId('id').textContent).toBe('project:p1')
    act(() => loc.navigate('/r/project/p1'))
    expect(screen.getByTestId('id').textContent).toBe('none')
  })

  it('closes on request', () => {
    renderAt(<Probe />)
    act(() => screen.getByText('open').click())
    act(() => screen.getByText('close').click())
    expect(screen.getByTestId('id').textContent).toBe('none')
  })
})
