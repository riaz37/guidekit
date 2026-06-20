# @guidekit/knowledge

<p align="center">
  <a href="https://guidekit-docs.vercel.app">
    <img src="../../assets/brand/wordmark.svg" alt="GuideKit" width="200" />
  </a>
</p>

<p align="center">
  <a href="https://guidekit-docs.vercel.app/docs/platform-mode">Documentation</a>
  ·
  <a href="https://github.com/riaz37/guidekit">GitHub</a>
</p>

[![npm version](https://img.shields.io/npm/v/@guidekit/knowledge?style=flat-square)](https://www.npmjs.com/package/@guidekit/knowledge)

Client-side BM25/TF-IDF knowledge retrieval for GuideKit Platform Mode.

- `KnowledgeStore` — in-memory document index with chunking
- `createKnowledgeContextProvider` — RAG sections for the pipeline retrieve stage

Requires `@guidekit/core@^1.0.0`. Enable with `knowledge={{ documents: [...] }}` on `GuideKitProvider`.

Runtime API: `addKnowledgeDocument` / `removeKnowledgeDocument` via core or `useGuideKitContext`.
