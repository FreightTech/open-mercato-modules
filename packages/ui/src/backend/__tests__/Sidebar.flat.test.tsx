/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { Sidebar, type SidebarGroup } from '../Sidebar'

jest.mock('next/link', () => {
  const React = require('react')
  return React.forwardRef(({ children, href, ...rest }: any, ref: React.ForwardedRef<HTMLAnchorElement>) => (
    <a href={typeof href === 'string' ? href : href?.toString?.()} ref={ref} {...rest}>
      {children}
    </a>
  ))
})

const groups: SidebarGroup[] = [
  { id: 'accounting', name: 'Accounting', items: [{ href: '/backend/e-registry', title: 'E-registry' }] },
  { id: 'rfs', name: 'RFS', items: [{ href: '/backend/rfs', title: 'RFS' }, { href: '/backend/carriers', title: 'Carriers' }] },
]

function renderSidebar(flat: boolean) {
  return render(
    <Sidebar
      mode="main"
      compact={false}
      pathname="/backend/rfs"
      brand={{ title: 'FreightTech' }}
      groups={groups}
      // A collapsed group must not hide its items once the list is flat.
      openGroups={{ rfs: false }}
      flat={flat}
    />,
  )
}

describe('Sidebar flat', () => {
  it('lists every item with no group headings when flat', () => {
    renderSidebar(true)
    expect(screen.queryByRole('button', { name: /accounting/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^rfs$/i })).toBeNull()
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(links).toEqual(expect.arrayContaining(['/backend/e-registry', '/backend/rfs', '/backend/carriers']))
    expect(links.indexOf('/backend/e-registry')).toBeLessThan(links.indexOf('/backend/rfs'))
  })

  it('keeps group headings by default', () => {
    renderSidebar(false)
    expect(screen.getByRole('button', { name: /accounting/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Carriers' })).toBeNull()
  })
})
