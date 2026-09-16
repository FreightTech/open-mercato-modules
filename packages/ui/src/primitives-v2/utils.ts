/*
  Local className concatenation helper. The legacy primitives in
  `../primitives/` depend on `@open-mercato/shared/lib/utils#cn`, but
  that subpath isn't in the shared package's `exports` map. The new
  components in this directory deliberately avoid that coupling.
*/
export function cn(...classes: Array<string | undefined | null | false>): string {
  return classes.filter(Boolean).join(' ')
}
