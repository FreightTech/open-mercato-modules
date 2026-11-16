// Storybook has no App Router: the hooks components call return inert stand-ins (navigation is swallowed).
const router = { push: () => undefined, replace: () => undefined, back: () => undefined, forward: () => undefined, refresh: () => undefined, prefetch: () => Promise.resolve() }
export const useRouter = () => router
export const usePathname = () => '/'
export const useSearchParams = () => new URLSearchParams()
export const useParams = () => ({})
export const redirect = () => undefined
export const notFound = () => undefined
