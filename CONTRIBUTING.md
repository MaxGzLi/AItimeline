# Contributing

AITimeline is early and moving quickly. Keep contributions small, grounded, and easy to verify.

## Development Workflow

1. Start from a green `main`: `npm run typecheck && npm test` should pass before you branch.
2. Create a branch per change (`fix/...`, `feat/...`, `docs/...`). Keep the diff scoped to one change.
3. If you touch `packages/core`, rebuild it before testing the API or web app: `npm run build -w @aitimeline/core`. New core behavior must be covered by extending a smoke script in `scripts/`.
4. Run the local checks below, then open a PR against `main`. CI runs typecheck, build and all three smokes on every PR and push to `main`.
5. For UI changes, capture before/after screenshots with the `docs/e2e/` tooling into `docs/e2e/runs/<date>-<slug>/`.

## Local Checks

Run these before pushing changes:

```bash
npm run typecheck
npm run build
npm test   # smoke:core + smoke:api + smoke:model
```

## Commit Identity

GitHub contribution credit depends on the commit author email. Configure Git with an email that is verified on your GitHub account:

```bash
git config user.name "Max"
git config user.email "741176438@qq.com"
```

For private repositories, enable private contribution visibility from your GitHub profile contribution settings if you want the activity to appear on your contribution graph.

## Harness Rule

Source-grounded knowledge is the core product promise. New generation or recommendation logic should preserve:

- source registry records
- citations
- grounding validation
- feedback expansion policy
- runtime smoke coverage
