# Virtual Perspectives and URL-Based Filtering

Virtual perspectives are perspectives with IDs starting with `__` (double underscore). They function normally but are hidden from the perspective tabs UI, making them ideal for:
- URL-based filtering (e.g., `?status=draft` from dashboard widgets)
- System-defined default views
- Temporary or transient perspectives

## Example: URL-Based Filtering

This pattern allows dashboard widgets or external links to pre-filter tables via URL parameters:

```tsx
import { useSearchParams, useRouter } from 'next/navigation'
import { useMemo, useRef, useEffect } from 'react'

// 1. Parse URL parameters into FilterRow format
function parseFiltersFromUrl(searchParams: URLSearchParams): FilterRow[] {
  const filters: FilterRow[] = []
  
  const status = searchParams.get('status')
  if (status) {
    filters.push({
      id: 'url-filter-status',
      field: 'status',
      operator: 'is_any_of',  // Use correct operator for multi-value
      values: status.split(','),
    })
  }
  
  return filters
}

// 2. Serialize filters back to URL
function serializeFiltersToUrl(filters: FilterRow[]): string {
  const params = new URLSearchParams()
  
  const statusFilter = filters.find(f => f.field === 'status')
  if (statusFilter && statusFilter.values.length > 0) {
    params.set('status', statusFilter.values.join(','))
  }
  
  return params.toString()
}

function MyTablePage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [activePerspectiveId, setActivePerspectiveId] = useState<string | null>(null)
  const [savedPerspectives, setSavedPerspectives] = useState<PerspectiveConfig[]>([])
  
  // 3. Create virtual perspective from URL filters (memoized for performance)
  const urlFilterPerspective = useMemo(() => {
    if (columns.length === 0) return null
    
    const urlFilters = parseFiltersFromUrl(searchParams)
    if (urlFilters.length === 0) return null
    
    return {
      id: '__url_filters__',
      name: 'Filters from URL',
      columns: {
        visible: columns.map(c => c.data),
        hidden: [],
      },
      filters: urlFilters,
      sorting: [],
    }
  }, [columns, searchParams])
  
  // 4. Initialize perspective only once (prevent infinite loop)
  const hasInitializedRef = useRef(false)
  
  useEffect(() => {
    if (urlFilterPerspective && !hasInitializedRef.current) {
      setSavedPerspectives([urlFilterPerspective, ...otherPerspectives])
      setActivePerspectiveId('__url_filters__')
      hasInitializedRef.current = true
    } else if (!urlFilterPerspective) {
      setSavedPerspectives(otherPerspectives)
    }
  }, [urlFilterPerspective])
  
  // 5. Handle filter changes - sync to URL and clear virtual perspective
  useEventHandlers({
    [TableEvents.FILTER_CHANGE]: (payload: { filters: FilterRow[] }) => {
      // Update URL to match filters
      const queryString = serializeFiltersToUrl(payload.filters)
      const newPath = queryString ? `?${queryString}` : window.location.pathname
      router.replace(newPath, { scroll: false })
      
      // Clear virtual perspective when user manually clears all filters
      if (payload.filters.length === 0 && activePerspectiveId === '__url_filters__') {
        setActivePerspectiveId(null)
      }
    },
    
    [TableEvents.PERSPECTIVE_DELETE]: async (payload) => {
      // Prevent deletion of virtual perspectives
      if (payload.id.startsWith('__')) {
        console.warn('Cannot delete virtual perspective:', payload.id)
        return
      }
      
      // ... handle regular perspective deletion
    },
  }, tableRef)
  
  return (
    <DynamicTable
      savedPerspectives={savedPerspectives}
      activePerspectiveId={activePerspectiveId}
      // ... other props
    />
  )
}
```

## Key Points for Virtual Perspectives

1. **IDs start with `__`** - This convention hides them from the UI tabs (filtered in `PerspectiveTabs.tsx`)

2. **Use stable filter IDs** - Don't use `Date.now()` in filter IDs. Use constants like `'url-filter-status'`

3. **Use `useMemo` for perspective** - Prevents recreation on every render (performance optimization)

4. **Track initialization with ref** - Prevents infinite loop when user clears filters:
   ```tsx
   const hasInitializedRef = useRef(false)
   if (urlFilterPerspective && !hasInitializedRef.current) {
     setActivePerspectiveId('__url_filters__')
     hasInitializedRef.current = true
   }
   ```

5. **Clear perspective when filters cleared** - In FILTER_CHANGE handler:
   ```tsx
   if (filters.length === 0 && activePerspectiveId === '__url_filters__') {
     setActivePerspectiveId(null)
   }
   ```

6. **Guard against deleting virtual perspectives**:
   ```tsx
   [TableEvents.PERSPECTIVE_DELETE]: (payload) => {
     if (payload.id.startsWith('__')) {
       return  // Silently ignore or show warning
     }
     // ... normal deletion
   }
   ```

7. **Use correct filter operators** - DynamicTable expects specific operator strings:
   - `'is_any_of'` - For multi-value fields (dropdowns, status)
   - `'equals'` - For exact single value
   - `'contains'` - For text search
   - `'is_empty'` / `'is_not_empty'` - For null checks

## Example: Dashboard Widget Link

```tsx
// In a dashboard widget
function DraftQuotesWidget() {
  return (
    <Link href="/backend/quotes?status=draft">
      <div className="stat-card">
        <h3>Draft Quotes</h3>
        <p className="count">{draftCount}</p>
      </div>
    </Link>
  )
}
```

When the user clicks this link:
1. They navigate to `/backend/quotes?status=draft`
2. The page parses `status=draft` into a FilterRow
3. A virtual perspective `__url_filters__` is created with that filter
4. The table displays filtered data with filter badge showing
5. The virtual perspective tab is hidden from the UI
6. If user clears the filter, URL updates to `/backend/quotes` and perspective is cleared

## Troubleshooting Infinite Loops

If you experience infinite loops when clearing filters:

**Symptom**: Filter appears → disappears → appears → repeat rapidly

**Common causes**:
1. **Re-setting perspective after clear**: Check that you're not re-setting `activePerspectiveId` after the user clears it
2. **Missing initialization ref**: Add `hasInitializedRef` pattern shown above
3. **Perspective in dependency array**: Don't include `activePerspectiveId` in useEffect deps that set it
4. **Creating new perspective objects**: Use `useMemo` to prevent recreation

**Solution checklist**:
- ✅ Use `hasInitializedRef` to track first-time initialization
- ✅ Only set `activePerspectiveId` when ref is false
- ✅ Clear perspective when filters.length === 0
- ✅ Use `useMemo` for perspective creation
- ✅ Use stable filter IDs (not `Date.now()`)

See the "Infinite Loop Prevention" section in `DynamicTable.tsx` perspective sync effect documentation for implementation details.

## Real-World Examples

### FMS Quotes Page
See `/packages/fms/src/modules/fms_offers/backend/fms-quotes/page.tsx` for a complete working example including:
- URL parameter parsing
- Bidirectional URL sync
- Virtual perspective creation with useMemo
- Initialization tracking to prevent loops
- Delete protection for virtual perspectives

### FMS Offers Page
See `/packages/fms/src/modules/fms_offers/backend/fms-offers/page.tsx` for a simpler example with:
- Basic URL filtering
- Virtual perspective management
- Similar infinite loop prevention patterns
