# Contributing

Thanks for your interest in the FreightTech Global Trade Logistics modules for
Open Mercato. This repo holds the `@freighttech/*` module packages and their
shared tooling.

## Repository layout

```
packages/<module-name>/   # one publishable @freighttech/* package per module
```

Each package is a workspace. Shared build/tsconfig live at the repo root.

## Branch model

- `main` is always releasable. No direct pushes.
- Branch from `main` using `feat/<slug>`, `fix/<slug>`, or `chore/<slug>`.
- Open a PR against `main`. At least one review is required before merge.
- Squash-merge; keep the PR title in the conventional-commits style
  (`feat(<module>): …`, `fix(<module>): …`).

## Module rules

These mirror Open Mercato's module development guide:

- **Package name:** `@freighttech/<module-name>` (kebab-case).
- **Module ID** inside the package: snake_case (e.g. `my_module`).
- Integrate **only** through UMES extension points (widget injection, event
  subscribers, response enrichers, API interceptors, custom entities). A module
  **MUST NOT** patch or modify Open Mercato core packages.
- No hard imports between domain modules — communicate via events, extension
  entities, and declared extension points.
- Set `ejectable: true` in module metadata when consumers should be able to
  take source ownership.
- Ship no secrets, credentials, or real customer data — including in fixtures.
  Configuration (API accounts, endpoints, proxies) is supplied by the consuming
  deployment, never baked into the package.

## Publishing

Packages publish to the **public npm** registry under the `@freighttech` scope
(`publishConfig.access: public`). Publish with `npm publish` from the package
directory; do not rely on a workspace-scoped registry override.

## PR checklist

Before requesting review, from the repo root:

- [ ] `yarn typecheck` passes
- [ ] `yarn lint` passes
- [ ] `yarn test` passes
- [ ] `yarn build` passes
- [ ] Public surface changes (exports, event IDs, API routes, DB columns, DI
      names, feature IDs) follow the deprecation protocol — additive by default;
      removals/renames need `@deprecated` + a bridge + a note in the PR.
- [ ] New/changed behaviour is covered by tests.
- [ ] No secrets or real data added.

## License

By contributing you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
