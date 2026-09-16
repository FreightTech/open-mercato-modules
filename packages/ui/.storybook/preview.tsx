import type { Preview } from '@storybook/react-vite'
import * as React from 'react'
import './preview.css'

/**
 * Theme switching.
 *
 * The `backgrounds` parameter below only repaints the canvas — it does NOT put
 * the app's `.dark` class on the document, so before this decorator every story
 * rendered its LIGHT tokens against a dark canvas and the dark palette could not
 * be reviewed at all. The design system's dark values live in `.dark { … }`
 * blocks in `tokens.v2.css` / `m3.css`, and `ThemeProvider` applies that class to
 * `document.documentElement` in the real app — so Storybook has to do the same.
 *
 * Pick the theme from the toolbar; `backgrounds` follows it automatically.
 */
const withTheme = (Story: React.ComponentType, context: { globals: { theme?: string } }) => {
  const theme = context.globals.theme ?? 'light'
  React.useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.style.colorScheme = theme
    return () => {
      root.classList.remove('dark')
      root.style.colorScheme = ''
    }
  }, [theme])
  return <Story />
}

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Light / dark design-token scheme',
      defaultValue: 'light',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'light', icon: 'sun', title: 'Light' },
          { value: 'dark', icon: 'moon', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [withTheme],
  parameters: {
    layout: 'padded',
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: 'oklch(0.99 0.005 250)' },
        { name: 'dark', value: 'oklch(0.14 0.02 250)' },
      ],
    },
  },
}

export default preview
