import * as React from 'react'
import { Search, X } from 'lucide-react'
import { Input, type InputProps, type InputSize } from './Input'
import { cn } from './utils'

/*
  Figma source: FMS-Componenets → SearchInput (component-set 149:375).
  State variants: default / focus / typing (with clear button) / disabled.

  Built as a thin specialization of `Input` so size/error/focus
  semantics stay consistent. Renders a search icon on the left and a
  clear "×" button on the right whenever the value is non-empty (and
  `onClear` is provided).
*/

export type SearchInputProps = Omit<InputProps, 'leftAddon' | 'rightAddon'> & {
  /** Called when the user clicks the inline clear button. */
  onClear?: () => void
  /** Override the default search icon. */
  searchIcon?: React.ReactNode
  /**
   * Optional keyboard shortcut hint rendered as a `<kbd>` pill on the
   * right side of the input when there's no value (Figma's `⌘K`
   * pattern). Hidden automatically while typing so the clear button
   * has room.
   */
  shortcut?: React.ReactNode
}

const DefaultSearchIcon = () => <Search aria-hidden="true" />


const CLEAR_PAD: Record<InputSize, string> = {
  sm: 'pr-9',
  md: 'pr-10',
  lg: 'pr-11',
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    onClear,
    searchIcon,
    shortcut,
    value,
    defaultValue,
    inputSize = 'md',
    placeholder = 'Szukaj…',
    type = 'search',
    className,
    ...props
  },
  ref,
) {
  // Track value so we know whether to render the clear button when uncontrolled.
  const [internalValue, setInternalValue] = React.useState<string | number | readonly string[] | undefined>(
    defaultValue,
  )
  const effectiveValue = value !== undefined ? value : internalValue
  const hasValue = !!effectiveValue && String(effectiveValue).length > 0
  const showClear = typeof onClear === 'function' && hasValue
  const showShortcut = !!shortcut && !hasValue

  const innerRef = React.useRef<HTMLInputElement | null>(null)
  React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (value === undefined) setInternalValue(e.target.value)
    props.onChange?.(e)
  }

  return (
    <span className="relative inline-flex w-full items-center">
      <Input
        ref={innerRef}
        type={type}
        placeholder={placeholder}
        leftAddon={searchIcon ?? <DefaultSearchIcon />}
        inputSize={inputSize}
        value={value}
        defaultValue={defaultValue}
        onChange={handleChange}
        className={cn(showClear || showShortcut ? CLEAR_PAD[inputSize] : null, className)}
        {...props}
      />
      {showShortcut ? (
        <kbd
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inline-flex items-center justify-center rounded border border-border-v2 bg-secondary-v2 px-1.5 font-mono text-[11px] text-muted-v2-foreground',
            inputSize === 'sm' ? 'right-2 h-4' : inputSize === 'lg' ? 'right-3 h-5' : 'right-2.5 h-[18px]',
          )}
        >
          {shortcut}
        </kbd>
      ) : null}
      {showClear ? (
        <button
          type="button"
          aria-label="Wyczyść wyszukiwanie"
          onClick={() => {
            if (value === undefined) setInternalValue('')
            if (innerRef.current) {
              innerRef.current.value = ''
              // Fire a synthetic change event so controlled callers stay in sync.
              const evt = new Event('input', { bubbles: true })
              innerRef.current.dispatchEvent(evt)
            }
            onClear?.()
            innerRef.current?.focus()
          }}
          className={cn(
            'absolute inline-flex items-center justify-center rounded-sm text-muted-v2-foreground',
            'hover:text-foreground-v2 transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-v2 focus-visible:ring-offset-1',
            inputSize === 'sm' ? 'right-2.5 h-4 w-4' : inputSize === 'lg' ? 'right-3.5 h-5 w-5' : 'right-3 h-4 w-4',
          )}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </span>
  )
})
