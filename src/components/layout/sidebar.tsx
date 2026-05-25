'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'

type NavItem = {
  label: string
  href: string
  icon: React.ReactNode
  /** Match the path exactly, instead of treating it as a prefix. */
  exact?: boolean
}

type NavGroup = {
  label?: string
  items: NavItem[]
}

const STROKE = '1.6'

const Icon = {
  close: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  // Sidebar collapse/expand toggle (rectangle with vertical bar — Claude's icon).
  sidebar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} className="h-[18px] w-[18px]">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  ),
}

export type SidebarUser = {
  email: string
  fullName: string | null
  isAdmin: boolean
}

// Emoji icons — naturally multicolor regardless of the surrounding text
// color, so they stay vivid on the blue gradient. The active row's amber
// pill doesn't try to recolor them.
const Emoji = ({ char, label }: { char: string; label: string }) => (
  <span role="img" aria-label={label} className="text-lg leading-none">
    {char}
  </span>
)

const mainGroup: NavGroup = {
  items: [
    { label: 'Dashboard', href: '/dashboard',         icon: <Emoji char="📊" label="Dashboard" /> },
    { label: 'Members',   href: '/dashboard/members', icon: <Emoji char="👥" label="Members" /> },
  ],
}

const transactionsGroup: NavGroup = {
  label: 'Transactions',
  items: [
    { label: 'Contributions', href: '/dashboard/contributions', icon: <Emoji char="💰" label="Contributions" /> },
    { label: 'Loans',         href: '/dashboard/loans',         icon: <Emoji char="🤝" label="Loans" /> },
    { label: 'Donations',     href: '/dashboard/donations',     icon: <Emoji char="❤️" label="Donations" /> },
  ],
}

const rulesGroup: NavGroup = {
  label: 'Rules',
  items: [
    { label: 'Overview',      href: '/rules',    icon: <Emoji char="📖" label="Overview" />, exact: true },
    { label: 'v1 — Original', href: '/rules/v1', icon: <Emoji char="📜" label="v1 Original" /> },
    { label: 'v2 — Revised',  href: '/rules/v2', icon: <Emoji char="📝" label="v2 Revised" /> },
  ],
}

const adminGroup: NavGroup = {
  label: 'Admin',
  items: [
    { label: 'Manage Loans',        href: '/admin/loans',            icon: <Emoji char="📑" label="Manage Loans" />, exact: true },
    { label: 'New Loan',            href: '/admin/loans/new',        icon: <Emoji char="🏦" label="New Loan" /> },
    { label: 'Add Transaction',     href: '/admin/transactions/new', icon: <Emoji char="➕" label="Add Transaction" /> },
    { label: 'Manage Transactions', href: '/admin/transactions',     icon: <Emoji char="💸" label="Manage Transactions" />, exact: true },
    { label: 'Pending Payments',    href: '/admin/pending',          icon: <Emoji char="📥" label="Pending Payments" /> },
    { label: 'Bank Accounts',       href: '/admin/bank-accounts',    icon: <Emoji char="💳" label="Bank Accounts" /> },
    { label: 'Reference Values',    href: '/admin/reference',        icon: <Emoji char="⚙️" label="Reference Values" /> },
  ],
}

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact || href === '/dashboard') return pathname === href
  return pathname === href || pathname.startsWith(href + '/')
}

function groupContainsActive(group: NavGroup, pathname: string): boolean {
  return group.items.some((item) => isActive(pathname, item.href, item.exact))
}

const SIDEBAR_COLLAPSED_KEY = 'fcf:sidebar:collapsed'

function NavItemLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem
  active: boolean
  collapsed: boolean
  onNavigate?: () => void
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={
        'group/item flex items-center gap-3 rounded-xl text-sm transition-all duration-150 ' +
        (collapsed ? 'mx-1 justify-center px-0 py-2.5' : 'px-3 py-2.5') +
        ' ' +
        (active
          ? 'bg-gradient-to-r from-amber-400 to-orange-500 font-semibold text-white shadow-md shadow-orange-500/40'
          : 'text-white/75 hover:bg-white/10 hover:text-white')
      }
    >
      {item.icon}
      {!collapsed && (
        <span className="truncate text-[13px] font-medium tracking-wide">
          {item.label}
        </span>
      )}
    </Link>
  )
}

function NavGroupSection({
  group,
  pathname,
  collapsed,
  open,
  setOpen,
  onNavigate,
}: {
  group: NavGroup
  pathname: string
  collapsed: boolean
  open: boolean
  setOpen: (next: boolean) => void
  onNavigate?: () => void
}) {
  const collapsible = Boolean(group.label) && !collapsed

  const items = (
    <div className="space-y-0.5">
      {group.items.map((item) => (
        <NavItemLink
          key={item.href}
          item={item}
          active={isActive(pathname, item.href, item.exact)}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  )

  // In collapsed mode, render items without any header; add a divider for visual rhythm.
  if (collapsed) {
    return (
      <div>
        {group.label && (
          <hr className="mx-3 my-2 border-t border-black/5" />
        )}
        {items}
      </div>
    )
  }

  // Top-level (no label) groups render flat.
  if (!collapsible) {
    return <div className="space-y-0.5">{items}</div>
  }

  return (
    <div className="space-y-1 border-t border-white/15 pt-3 first:border-t-0 first:pt-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="group/header flex w-full items-center justify-between rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70 transition-colors hover:text-white"
      >
        <span>{group.label}</span>
        <span
          className={
            'text-white/60 transition-transform duration-200 ' +
            (open ? 'rotate-0' : '-rotate-90')
          }
        >
          {Icon.chevron}
        </span>
      </button>
      <div
        className={
          'grid transition-[grid-template-rows] duration-200 ' +
          (open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')
        }
      >
        <div className="overflow-hidden">{items}</div>
      </div>
    </div>
  )
}

function NavList({
  groups,
  pathname,
  collapsed,
  onNavigate,
}: {
  groups: NavGroup[]
  pathname: string
  collapsed: boolean
  onNavigate?: () => void
}) {
  const initialState = useMemo(() => {
    const map: Record<string, boolean> = {}
    for (const g of groups) if (g.label) map[g.label] = groupContainsActive(g, pathname)
    return map
  }, [groups, pathname])

  const [openState, setOpenState] = useState<Record<string, boolean>>(initialState)

  // gap-1 between groups; labelled groups add their own pt-3 above for breathing room
  return (
    <nav className="flex flex-col gap-1">
      {groups.map((group, gi) => {
        const label = group.label
        return (
          <NavGroupSection
            key={gi}
            group={group}
            pathname={pathname}
            collapsed={collapsed}
            open={label ? (openState[label] ?? false) : true}
            setOpen={(next) => {
              if (!label) return
              setOpenState((s) => ({ ...s, [label]: next }))
            }}
            onNavigate={onNavigate}
          />
        )
      })}
    </nav>
  )
}

function SidebarBody({
  collapsed,
  setCollapsed,
  closeDrawer,
  pathname,
  groups,
  isMobile,
}: {
  collapsed: boolean
  setCollapsed: (next: boolean) => void
  closeDrawer?: () => void
  pathname: string
  groups: NavGroup[]
  isMobile: boolean
}) {
  return (
    <aside
      className={
        'flex h-full flex-col bg-gradient-to-b from-blue-600 to-indigo-700 text-white transition-[width] duration-200 ease-out ' +
        (collapsed ? 'w-16' : 'w-64') +
        (isMobile ? ' rounded-2xl shadow-xl ring-1 ring-black/10' : '')
      }
    >
      {/* Header */}
      <div
        className={
          (collapsed
            ? 'flex flex-col items-center gap-2 px-2 pt-3'
            : 'flex items-center justify-between px-3 pt-3')
        }
      >
        {collapsed ? (
          <Image
            src="/logo.png"
            alt="Friends Cooperative Fund"
            width={36}
            height={36}
            className="h-9 w-9 rounded-full"
            priority
          />
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <Image
              src="/logo.png"
              alt="Friends Cooperative Fund"
              width={36}
              height={36}
              className="h-9 w-9 flex-shrink-0 rounded-full"
              priority
            />
            <span className="truncate text-sm font-semibold text-white">FCF Tracker</span>
          </div>
        )}
        {isMobile ? (
          <button
            type="button"
            onClick={closeDrawer}
            className="rounded-md p-2 text-white/70 hover:bg-white/10 hover:text-white"
            aria-label="Close menu"
          >
            {Icon.close}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="rounded-md p-2 text-white/70 hover:bg-white/10 hover:text-white"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {Icon.sidebar}
          </button>
        )}
      </div>

      {/* Nav */}
      <div className={'flex-1 overflow-y-auto ' + (collapsed ? 'px-1 py-3' : 'px-2 py-3')}>
        <NavList
          groups={groups}
          pathname={pathname}
          collapsed={collapsed}
          onNavigate={closeDrawer}
        />
      </div>

      <div className="h-3" />
    </aside>
  )
}

const SIDEBAR_TOGGLE_EVENT = 'fcf:sidebar:toggled'

function subscribeToSidebarState(cb: () => void) {
  window.addEventListener('storage', cb)
  window.addEventListener(SIDEBAR_TOGGLE_EVENT, cb)
  return () => {
    window.removeEventListener('storage', cb)
    window.removeEventListener(SIDEBAR_TOGGLE_EVENT, cb)
  }
}

function readCollapsed() {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export function Sidebar({ user }: { user: SidebarUser }) {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const collapsed = useSyncExternalStore(
    subscribeToSidebarState,
    readCollapsed,
    () => false,
  )

  const setCollapsed = (next: boolean) => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(SIDEBAR_TOGGLE_EVENT))
  }

  const groups: NavGroup[] = [
    mainGroup,
    transactionsGroup,
    rulesGroup,
    ...(user.isAdmin ? [adminGroup] : []),
  ]

  // Listen for the top bar's hamburger button (custom event, avoids prop-drilling
  // through the server-rendered layout).
  useEffect(() => {
    const handler = () => setDrawerOpen(true)
    window.addEventListener('sidebar:open', handler)
    return () => window.removeEventListener('sidebar:open', handler)
  }, [])

  return (
    <>
      {/* Desktop persistent sidebar — edge-to-edge, no gaps with main column */}
      <div className="hidden lg:sticky lg:top-0 lg:block lg:h-screen lg:flex-shrink-0">
        <SidebarBody
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          pathname={pathname}
          groups={groups}
          isMobile={false}
        />
      </div>

      {/* Mobile drawer — shadcn Sheet provides focus trap, escape-to-close,
          inert-content-behind, and the slide-in animation for free. */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="left"
          className="w-72 max-w-[85vw] border-0 bg-transparent p-0 shadow-none lg:hidden"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>Site navigation</SheetDescription>
          </SheetHeader>
          <SidebarBody
            collapsed={false}
            setCollapsed={() => undefined}
            closeDrawer={() => setDrawerOpen(false)}
            pathname={pathname}
            groups={groups}
            isMobile={true}
          />
        </SheetContent>
      </Sheet>
    </>
  )
}
