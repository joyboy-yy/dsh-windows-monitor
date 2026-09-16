## What changed

<!-- One or two sentences. Link the issue if there is one. -->

## Verification

Which platform did you run the suite on, and what did it print?

- [ ] Windows
- [ ] Linux
- [ ] macOS
- [ ] Not platform-specific (docs, CI, client-only)

```
<paste `pnpm run test` output, or `DEBUG_COLLECTOR=1 pnpm run test` for collector changes>
```

## Checklist

- [ ] `pnpm run typecheck`, `pnpm run test` and `pnpm run build` all pass locally
- [ ] `git diff --exit-code -- lib` is clean — the committed build output matches this source
- [ ] Collectors stay read-only: no writes, no installs, no state changes
- [ ] No literal `${` was added to a collector script
- [ ] The client bundle still refuses to inline React
- [ ] `README.md` and `README.zh.md` were updated together, if user-facing behaviour changed
- [ ] New behaviour has a test, or this PR says why it cannot have one
