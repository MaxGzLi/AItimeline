# Contributing

AITimeline is early and moving quickly. Keep contributions small, grounded, and easy to verify.

## Local Checks

Run these before pushing changes:

```bash
npm run typecheck
npm run build
npm run smoke:core
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
