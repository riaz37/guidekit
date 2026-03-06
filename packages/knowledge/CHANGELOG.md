# @guidekit/knowledge

## 1.0.0

### Minor Changes

- feat(knowledge): add @guidekit/knowledge package with BM25/TF-IDF search

  - KnowledgeStore: document management with add/remove/update/search
  - BM25Index: BM25 Okapi relevance ranking (pure implementation, no deps)
  - TFIDFIndex: TF-IDF with logarithmic TF scoring
  - Document chunker with heading, paragraph, and fixed-size strategies
  - Source attribution with markdown citation formatting
  - Knowledge context provider for LLM prompt integration
  - Knowledge types added to @guidekit/core

### Patch Changes

- Updated dependencies
  - @guidekit/core@0.1.0
