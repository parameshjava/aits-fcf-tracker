type Crumb = { label: string; href?: string }
type RouteMeta = { title: string; crumbs: Crumb[] }

// Static route → breadcrumb mapping. Dynamic segments (if added later) would
// need separate handling — every route here is static.
const ROUTES: Record<string, RouteMeta> = {
  '/dashboard': {
    title: 'Dashboard',
    crumbs: [{ label: 'Dashboard' }],
  },
  '/dashboard/contributions': {
    title: 'Contributions',
    crumbs: [{ label: 'Transactions' }, { label: 'Contributions' }],
  },
  '/dashboard/loans': {
    title: 'Loans',
    crumbs: [{ label: 'Transactions' }, { label: 'Loans' }],
  },
  '/dashboard/donations': {
    title: 'Donations',
    crumbs: [{ label: 'Transactions' }, { label: 'Donations' }],
  },
  '/dashboard/members': {
    title: 'Members directory',
    crumbs: [{ label: 'Members' }],
  },
  '/rules': {
    title: 'Rules & Guidelines',
    crumbs: [{ label: 'Rules' }, { label: 'Overview' }],
  },
  '/rules/v1': {
    title: 'Original resolutions',
    crumbs: [{ label: 'Rules', href: '/rules' }, { label: 'v1 — Original' }],
  },
  '/rules/v2': {
    title: 'Revised resolutions',
    crumbs: [{ label: 'Rules', href: '/rules' }, { label: 'v2 — Revised' }],
  },
  '/admin': {
    title: 'Admin panel',
    crumbs: [{ label: 'Admin' }],
  },
  '/admin/transactions': {
    title: 'Manage transactions',
    crumbs: [{ label: 'Admin', href: '/admin' }, { label: 'Transactions' }],
  },
  '/admin/transactions/new': {
    title: 'Add transaction',
    crumbs: [
      { label: 'Admin', href: '/admin' },
      { label: 'Transactions', href: '/admin/transactions' },
      { label: 'New' },
    ],
  },
  '/admin/pending': {
    title: 'Pending payments',
    crumbs: [{ label: 'Admin', href: '/admin' }, { label: 'Pending payments' }],
  },
  '/admin/bank-accounts': {
    title: 'Bank accounts',
    crumbs: [{ label: 'Admin', href: '/admin' }, { label: 'Bank accounts' }],
  },
  '/polls': {
    title: 'Polls',
    crumbs: [{ label: 'Polls' }],
  },
  '/admin/polls/new': {
    title: 'New poll',
    crumbs: [
      { label: 'Admin', href: '/admin' },
      { label: 'Polls', href: '/polls' },
      { label: 'New' },
    ],
  },
}

export function resolveBreadcrumb(pathname: string): RouteMeta {
  if (ROUTES[pathname]) return ROUTES[pathname]

  // Fallback: derive from path segments (Title-cased) so unmapped routes still
  // render a sensible header.
  const segments = pathname.split('/').filter(Boolean)
  const title = segments[segments.length - 1]?.replace(/[-_]/g, ' ') ?? 'Home'
  return {
    title: title.replace(/\b\w/g, (c) => c.toUpperCase()),
    crumbs: segments.map((s) => ({ label: s.replace(/[-_]/g, ' ') })),
  }
}
