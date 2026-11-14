// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { NotFound } from './NotFound'

afterEach(() => cleanup())

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<NotFound defaultEventSlug="code-camp-2026" />} />
      </Routes>
    </MemoryRouter>,
  )

describe('not-found page (QA D5)', () => {
  it('has a heading, one plain sentence and a link to the event home', () => {
    at('/nowhere')
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy()
    expect(screen.getByText('This page does not exist, or its link has changed.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to the event home' }).getAttribute('href')).toBe('/e/code-camp-2026')
  })

  it('inside an event, the link goes back to that event', () => {
    at('/e/another-con/booth/x/y')
    expect(screen.getByRole('link', { name: 'Go to the event home' }).getAttribute('href')).toBe('/e/another-con')
  })
})
