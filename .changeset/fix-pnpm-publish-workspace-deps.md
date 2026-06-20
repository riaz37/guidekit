---
"@guidekit/core": patch
"@guidekit/react": patch
"@guidekit/cli": patch
"@guidekit/vanilla": patch
---

Fix publish pipeline to use `pnpm publish` instead of `npm publish`, so `workspace:^` internal dependencies are rewritten to semver ranges in published tarballs.
