# @guidekit/knowledge

Client-side BM25/TF-IDF knowledge retrieval for GuideKit Platform Mode.

- `KnowledgeStore` — in-memory document index with chunking
- `createKnowledgeContextProvider` — RAG sections for the pipeline retrieve stage

Requires `@guidekit/core@^1.0.0`. Enable with `knowledge={{ documents: [...] }}` on `GuideKitProvider`.

Runtime API: `addKnowledgeDocument` / `removeKnowledgeDocument` via core or `useGuideKitContext`.
