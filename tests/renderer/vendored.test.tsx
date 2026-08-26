// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Command } from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

describe('vendored shadcn primitives', () => {
  it('cn merges and dedupes tailwind classes', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-foreground', false && 'hidden')).toBe('text-foreground')
  })

  it('Button renders with the primary token classes', () => {
    render(<Button>Send</Button>)
    const button = screen.getByRole('button', { name: 'Send' })
    expect(button.className).toMatch(/bg-primary/)
    expect(button.className).toMatch(/text-primary-foreground/)
  })

  it('Button variants and sizes exist', () => {
    render(<Button variant="outline" size="sm">Retry</Button>)
    expect(screen.getByRole('button', { name: 'Retry' }).className).toMatch(/border/)
  })

  it('Kbd, Badge, and Command render', () => {
    render(<><Kbd>cmd-enter</Kbd><Badge>LOCAL</Badge><Command>palette</Command></>)
    expect(screen.getByText('cmd-enter')).toBeInTheDocument()
    expect(screen.getByText('LOCAL')).toBeInTheDocument()
    expect(screen.getByText('palette')).toBeInTheDocument()
  })
})
