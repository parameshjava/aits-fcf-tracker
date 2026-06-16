// Maps the existing shadcn/base-ui Button API (variant + size) onto
// PrimeReact Button props. Pure + unit-tested so the wrapper component
// stays a thin presentational shell.
export type UiVariant =
  | 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link'
export type UiSize = 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg'

export type PrimeButtonShape = {
  severity: 'secondary' | 'danger' | undefined
  outlined: boolean
  text: boolean
  prSize: 'small' | 'large' | undefined
}

export function toPrimeButton(variant: UiVariant, size: UiSize): PrimeButtonShape {
  const severity =
    variant === 'destructive' ? 'danger'
    : variant === 'secondary' ? 'secondary'
    : undefined
  const outlined = variant === 'outline'
  const text = variant === 'ghost' || variant === 'link'
  const prSize =
    size === 'sm' || size === 'xs' || size === 'icon-xs' || size === 'icon-sm' ? 'small'
    : size === 'lg' || size === 'icon-lg' ? 'large'
    : undefined
  return { severity, outlined, text, prSize }
}
