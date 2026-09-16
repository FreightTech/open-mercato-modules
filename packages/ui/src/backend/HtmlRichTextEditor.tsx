'use client'

import * as React from 'react'
import { Button } from '../primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { sanitizeHtmlRichText, sanitizeRichTextHref, sanitizeRichTextPasteContent } from './utils/richTextSanitizer'

export type HtmlRichTextEditorProps = {
  value?: string
  onChange: (html: string) => void
  /** Optional extra classes for the editable surface (e.g. min-height overrides). */
  editableClassName?: string
}

/**
 * Standalone rich-text (HTML) editor — a contentEditable surface with a
 * Bold/Italic/Underline/List/H3/Link toolbar. Emits sanitized HTML via
 * `onChange`. Mirrors the editor embedded in CrudForm, exposed standalone for
 * FMS's hand-rolled forms (offer condition presets, offer wizard terms, …).
 * Supported tags are the sanitizer subset: p, strong/b, em/i, u, ul/li, h3, a.
 */
export const HtmlRichTextEditor = React.memo(function HtmlRichTextEditor({
  value = '',
  onChange,
  editableClassName,
}: HtmlRichTextEditorProps) {
  const t = useT()
  const boldLabel = t('ui.forms.richtext.bold')
  const italicLabel = t('ui.forms.richtext.italic')
  const underlineLabel = t('ui.forms.richtext.underline')
  const listLabel = t('ui.forms.richtext.list')
  const heading3Label = t('ui.forms.richtext.heading3')
  const linkLabel = t('ui.forms.richtext.link')
  const linkUrlPrompt = t('ui.forms.richtext.linkUrlPrompt')
  const ref = React.useRef<HTMLDivElement | null>(null)
  const applyingExternal = React.useRef(false)
  const typingRef = React.useRef(false)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const current = el.innerHTML
    const sanitizedValue = sanitizeHtmlRichText(value)
    if (!typingRef.current && current !== sanitizedValue) {
      applyingExternal.current = true
      el.innerHTML = sanitizedValue
      requestAnimationFrame(() => { applyingExternal.current = false })
    }
  }, [value])

  const exec = (cmd: string, arg?: string) => {
    const el = ref.current
    if (!el) return
    el.focus()
    try {
      document.execCommand(cmd, false, arg)
    } catch {
      // ignore execCommand failures
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const isMod = e.metaKey || e.ctrlKey
    if (!isMod) return
    const k = e.key.toLowerCase()
    if (k === 'b') { e.preventDefault(); exec('bold') }
    if (k === 'i') { e.preventDefault(); exec('italic') }
    if (k === 'u') { e.preventDefault(); exec('underline') }
  }

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const html = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')
    const sanitizedPaste = sanitizeRichTextPasteContent(html, text)
    if (!sanitizedPaste) return

    e.preventDefault()
    exec(sanitizedPaste.command, sanitizedPaste.value)
  }

  return (
    <div className="w-full rounded border">
      <div className="flex items-center gap-1 px-2 py-1 border-b">
        <Button variant="ghost" size="sm" className="h-auto px-2 py-0.5 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}>{boldLabel}</Button>
        <Button variant="ghost" size="sm" className="h-auto px-2 py-0.5 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}>{italicLabel}</Button>
        <Button variant="ghost" size="sm" className="h-auto px-2 py-0.5 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')}>{underlineLabel}</Button>
        <span className="mx-2 text-muted-foreground">|</span>
        <Button variant="ghost" size="sm" className="h-auto px-2 py-0.5 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')}>• {listLabel}</Button>
        <Button variant="ghost" size="sm" className="h-auto px-2 py-0.5 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', '<h3>')}>{heading3Label}</Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto px-2 py-0.5 text-xs"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const url = sanitizeRichTextHref(window.prompt(linkUrlPrompt))
            if (url) exec('createLink', url)
          }}
        >{linkLabel}</Button>
      </div>
      <div
        ref={ref}
        className={`w-full px-2 py-2 min-h-[100px] sm:min-h-[160px] focus:outline-none prose prose-sm max-w-none ${editableClassName ?? ''}`}
        contentEditable
        suppressContentEditableWarning
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onInput={() => { if (!applyingExternal.current) typingRef.current = true }}
        onBlur={() => {
          const el = ref.current
          if (!el) return
          typingRef.current = false
          const sanitizedValue = sanitizeHtmlRichText(el.innerHTML)
          if (el.innerHTML !== sanitizedValue) {
            applyingExternal.current = true
            el.innerHTML = sanitizedValue
            requestAnimationFrame(() => { applyingExternal.current = false })
          }
          onChange(sanitizedValue)
        }}
      />
    </div>
  )
}, (prev, next) => prev.value === next.value)
