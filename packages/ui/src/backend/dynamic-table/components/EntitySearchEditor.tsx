'use client'

import * as React from 'react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch } from '../../utils/api'

// Dynamically load editor styles
if (typeof window !== 'undefined') {
  // @ts-ignore - CSS import handled by bundler
  import('../styles/DynamicTable.css')
}

const POPUP_MAX_HEIGHT = 200

export type SearchResult = {
  entityId: string
  recordId: string
  presenter?: {
    title?: string
    subtitle?: string
    icon?: string
    badge?: string
  }
  fields?: Record<string, unknown>
}

export type EntitySearchEditorConfig = {
  entityType: string
  extractValue: (result: SearchResult) => string
  additionalFields?: (result: SearchResult) => Record<string, any>
  formatOption?: (result: SearchResult) => {
    primary: string
    secondary?: string
  }
  placeholder?: string
  transformInput?: (value: string) => string
  // Parse initial value for display (e.g., extract name from JSON)
  parseInitialValue?: (value: string) => string
  minQueryLength?: number
  debounceMs?: number
  noResultsText?: string
  searchingText?: string
  // Search API configuration
  searchUrl?: string
  searchStrategy?: string
  searchLimit?: number
  // Extra query params merged into the search request, computed per row. Lets a
  // cell filter results by row context (e.g. a leg's mode → carrier role) when
  // paired with a custom `searchUrl`. Falsy values are skipped.
  buildExtraParams?: (rowData: any) => Record<string, string | null | undefined>
  // Organization scoping - when true (default), only show results from current organization
  scoped?: boolean
  // Initial suggestions shown when dropdown opens without typing
  initialSuggestions?: {
    // Async function to load initial suggestions (called once on mount)
    loadItems: () => Promise<SearchResult[]>
    // Number of items to show (default: 4)
    limit?: number
  }
}

type EntitySearchEditorProps = {
  config: EntitySearchEditorConfig
  value: any
  onChange: (newValue: any) => void
  onSave: (newValue?: any) => void
  onCancel: () => void
  rowData?: any
}

function calculatePopupPosition(cellRef: React.RefObject<HTMLElement | null>) {
  if (!cellRef.current) return { top: 0, left: 0, width: 0, openAbove: false }

  const rect = cellRef.current.getBoundingClientRect()
  const viewportHeight = window.innerHeight

  const spaceBelow = viewportHeight - rect.bottom
  const spaceAbove = rect.top

  let top: number
  let openAbove = false
  if (spaceBelow >= POPUP_MAX_HEIGHT || spaceBelow >= spaceAbove) {
    top = rect.bottom + 2
  } else {
    // Position at cell top; renderers apply translateY(-100%) to flip above
    top = rect.top - 2
    openAbove = true
  }

  return {
    top,
    left: rect.left,
    width: Math.max(rect.width, 200),
    openAbove,
  }
}

// Patterns to filter out IDs from display
// Matches: full UUIDs with dashes, UUIDs without dashes, and hex-only ID strings (8+ chars)
const UUID_WITH_DASHES = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UUID_WITHOUT_DASHES = /^[0-9a-f]{32}$/i
const HEX_ID_PATTERN = /^[0-9a-f]{8,}$/i

function looksLikeIdOrUuid(value: string | undefined): boolean {
  if (!value) return false
  return UUID_WITH_DASHES.test(value) || UUID_WITHOUT_DASHES.test(value) || HEX_ID_PATTERN.test(value)
}

function defaultFormatOption(result: SearchResult): { primary: string; secondary?: string } {
  const title = result.presenter?.title
  const subtitle = result.presenter?.subtitle

  // Don't show UUID/hex ID as primary - use a fallback
  const primary = title && !looksLikeIdOrUuid(title)
    ? title
    : result.recordId.slice(0, 8) + '...'

  // Don't show UUID/hex ID as secondary
  const secondary = subtitle && !looksLikeIdOrUuid(subtitle)
    ? subtitle
    : undefined

  return { primary, secondary }
}

export function EntitySearchEditor({
  config,
  value,
  onChange,
  onSave,
  onCancel,
  rowData,
}: EntitySearchEditorProps) {
  const {
    entityType,
    extractValue,
    additionalFields,
    formatOption = defaultFormatOption,
    placeholder = 'Type to search...',
    transformInput,
    parseInitialValue,
    minQueryLength = 2,
    debounceMs = 300,
    noResultsText = 'No results found',
    searchingText = 'Searching...',
    searchUrl = '/api/search/search',
    /**
     * `'fulltext'`, NOT `'meilisearch'`.
     *
     * The search module's valid strategy ids are `'tokens' | 'vector' |
     * 'fulltext'`, and the Meilisearch driver registers under `fulltext`
     * (`@open-mercato/search/src/fulltext/drivers`). `strategies=meilisearch`
     * matches NO strategy, so these call sites silently fell through to hashed
     * token search — which returns results, which is why nobody caught it.
     * `LocationSearchInput` always had it right.
     */
    searchStrategy = 'fulltext',
    searchLimit = 20,
    // Default to scoped=true for organization isolation
    scoped = true,
    initialSuggestions,
    buildExtraParams,
  } = config

  // Parse the initial value for display (e.g., extract name from JSON)
  const getInitialDisplayValue = (val: any): string => {
    const strValue = String(val ?? '')
    if (parseInitialValue) {
      return parseInitialValue(strValue)
    }
    // Default: try to parse as JSON and extract 'name' field
    try {
      const parsed = JSON.parse(strValue)
      if (parsed && typeof parsed === 'object' && 'name' in parsed) {
        return parsed.name
      }
    } catch {
      // Not JSON, return as-is
    }
    return strValue
  }

  const [showDropdown, setShowDropdown] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, openAbove: false })
  const [textValue, setTextValue] = useState(getInitialDisplayValue(value))
  const [results, setResults] = useState<SearchResult[]>([])
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [hasUserTyped, setHasUserTyped] = useState(false)
  // Initial suggestions state
  const [initialResults, setInitialResults] = useState<SearchResult[]>([])
  const [isLoadingInitial, setIsLoadingInitial] = useState(false)
  const [initialLoaded, setInitialLoaded] = useState(false)

  const cellRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const isClickingDropdownRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Position cursor at end of text on mount
  useEffect(() => {
    setTimeout(() => {
      if (cellRef.current) {
        const length = cellRef.current.value?.length || 0
        cellRef.current.selectionStart = length
        cellRef.current.selectionEnd = length
      }
    }, 0)
  }, [])

  // Load initial suggestions on mount (if configured)
  useEffect(() => {
    if (!initialSuggestions?.loadItems || initialLoaded) return

    const loadInitial = async () => {
      setIsLoadingInitial(true)
      try {
        const items = await initialSuggestions.loadItems()
        const limit = initialSuggestions.limit ?? 4
        setInitialResults(items.slice(0, limit))
        // Show dropdown immediately if we have initial results and user hasn't typed
        if (items.length > 0 && !hasUserTyped) {
          setShowDropdown(true)
        }
      } catch (error) {
        console.error('Failed to load initial suggestions:', error)
      } finally {
        setIsLoadingInitial(false)
        setInitialLoaded(true)
      }
    }

    loadInitial()
  }, [initialSuggestions, initialLoaded, hasUserTyped])

  // Debounce search query
  useEffect(() => {
    if (!hasUserTyped) return
    const timer = setTimeout(() => {
      setDebouncedQuery(textValue)
    }, debounceMs)
    return () => clearTimeout(timer)
  }, [textValue, hasUserTyped, debounceMs])

  // Fetch results from search API
  useEffect(() => {
    if (!hasUserTyped || debouncedQuery.length < minQueryLength) {
      setResults([])
      setShowDropdown(false)
      return
    }

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    const controller = new AbortController()
    abortControllerRef.current = controller

    const fetchResults = async () => {
      setIsLoading(true)
      try {
        const params = new URLSearchParams({
          q: debouncedQuery,
          strategies: searchStrategy,
          entityTypes: entityType,
          limit: String(searchLimit),
          scoped: scoped ? 'true' : 'false',
        })
        // Per-row extra params (e.g. a leg mode → carrier role filter).
        if (buildExtraParams) {
          for (const [k, v] of Object.entries(buildExtraParams(rowData) || {})) {
            if (v) params.set(k, v)
          }
        }

        const response = await apiFetch(`${searchUrl}?${params.toString()}`, {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error('Search failed')
        }

        const data = await response.json()
        setResults(data.results || [])
        setShowDropdown(true)
        setHighlightedIndex(0)
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('Entity search error:', error)
          setResults([])
        }
      } finally {
        setIsLoading(false)
      }
    }

    fetchResults()

    return () => controller.abort()
  }, [debouncedQuery, entityType, minQueryLength, searchUrl, searchStrategy, searchLimit, scoped])

  // Update position
  useEffect(() => {
    if (cellRef.current) {
      const pos = calculatePopupPosition(cellRef)
      setPosition(pos)
    }

    const updatePosition = () => {
      if (cellRef.current && showDropdown) {
        const pos = calculatePopupPosition(cellRef)
        setPosition(pos)
      }
    }

    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)

    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [showDropdown])

  // Click outside handling
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const isOutsideCell = cellRef.current && !cellRef.current.contains(e.target as Node)
      const isOutsideDropdown = !dropdownRef.current || !dropdownRef.current.contains(e.target as Node)

      if (isOutsideCell && isOutsideDropdown) {
        setShowDropdown(false)
        // Don't save on click outside - only API-selected values are valid
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleOptionClick = useCallback((result: SearchResult) => {
    // Set this immediately to prevent blur from interfering
    isClickingDropdownRef.current = true
    const selectedValue = extractValue(result)
    const { primary } = formatOption(result)

    // Apply additional fields to rowData if configured
    if (additionalFields && rowData) {
      const extraFields = additionalFields(result)
      Object.assign(rowData, extraFields)
    }

    // Use display-friendly value for textarea, raw value for data
    setTextValue(primary)
    setShowDropdown(false)
    onChange(selectedValue)
    // Call onSave directly - setTimeout can fail if component unmounts
    onSave(selectedValue)
  }, [extractValue, formatOption, additionalFields, rowData, onChange, onSave])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Use the appropriate results based on whether user has typed
    const displayResults = hasUserTyped ? results : initialResults

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()

      if (showDropdown && displayResults.length > 0) {
        const selected = displayResults[highlightedIndex]
        handleOptionClick(selected)
      } else {
        // No results to select - just close dropdown, don't save typed text
        setShowDropdown(false)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setShowDropdown(false)
      onCancel()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(prev =>
        prev < displayResults.length - 1 ? prev + 1 : prev
      )
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(prev => prev > 0 ? prev - 1 : 0)
    } else if (e.key === 'Tab') {
      setShowDropdown(false)
      // Don't save - only API-selected values are valid, save happens on selection
    }
  }, [showDropdown, results, initialResults, hasUserTyped, highlightedIndex, handleOptionClick, onCancel])

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    let val = e.target.value
    if (transformInput) {
      val = transformInput(val)
    }
    setTextValue(val)
    onChange(val)
    setHasUserTyped(true)
  }, [onChange, transformInput])

  return (
    <>
      <textarea
        ref={cellRef}
        value={textValue}
        onChange={handleTextChange}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Don't save on blur - only API-selected values are valid
          // Save happens on selection via handleOptionClick
        }}
        autoFocus
        className="hot-cell-editor hot-dropdown-editor"
        placeholder={placeholder}
      />

      {showDropdown && createPortal(
        <div
          ref={dropdownRef}
          className="hot-editor-dropdown"
          style={{
            position: 'fixed',
            top: `${position.top}px`,
            left: `${position.left}px`,
            width: `${position.width}px`,
            maxHeight: `${POPUP_MAX_HEIGHT}px`,
            overflowY: 'auto',
            zIndex: 10000,
            pointerEvents: 'auto',
            ...(position.openAbove ? { transform: 'translateY(-100%)' } : {}),
          }}
          onMouseDown={(e) => {
            e.stopPropagation()
            isClickingDropdownRef.current = true
          }}
          onMouseUp={() => {
            isClickingDropdownRef.current = false
          }}
        >
          {(() => {
            // Determine which results to display
            const displayResults = hasUserTyped ? results : initialResults
            const showLoading = hasUserTyped ? isLoading : isLoadingInitial

            if (showLoading) {
              return (
                <div className="hot-editor-dropdown-empty">
                  {searchingText}
                </div>
              )
            }

            if (displayResults.length === 0) {
              // Only show "no results" message if user has typed
              if (hasUserTyped) {
                return (
                  <div className="hot-editor-dropdown-empty">
                    {noResultsText}
                  </div>
                )
              }
              // For initial suggestions, show nothing if empty
              return null
            }

            return displayResults.map((result, index) => {
              const { primary, secondary } = formatOption(result)

              return (
                <div
                  key={result.recordId}
                  className={`hot-editor-dropdown-item ${index === highlightedIndex ? 'highlighted' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleOptionClick(result)
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                >
                  <div className="hot-editor-dropdown-item-primary">{primary}</div>
                  {secondary && (
                    <div className="hot-editor-dropdown-item-secondary">{secondary}</div>
                  )}
                </div>
              )
            })
          })()}
        </div>,
        document.body
      )}
    </>
  )
}

// Factory function to create a DynamicTable-compatible editor
export type DynamicTableEditorFn = (
  value: any,
  onChange: (v: any) => void,
  onSave: (v?: any) => void,
  onCancel: () => void,
  rowData: any,
  col: any,
  rowIndex: number,
  colIndex: number
) => React.ReactNode

export function createEntitySearchEditor(
  config: EntitySearchEditorConfig
): DynamicTableEditorFn {
  return (value, onChange, onSave, onCancel, rowData) => (
    <EntitySearchEditor
      config={config}
      value={value}
      onChange={onChange}
      onSave={onSave}
      onCancel={onCancel}
      rowData={rowData}
    />
  )
}
