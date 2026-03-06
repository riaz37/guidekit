/** Common English stopwords for filtering. */
const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'not', 'no', 'nor', 'so', 'yet',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'have', 'has', 'had', 'having',
  'do', 'does', 'did', 'doing',
  'will', 'would', 'could', 'should', 'shall', 'may', 'might', 'must', 'can',
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  'if', 'then', 'else', 'when', 'where', 'why', 'how', 'whether',
  'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with', 'about', 'against',
  'between', 'through', 'during', 'before', 'after', 'above', 'below',
  'up', 'down', 'out', 'off', 'over', 'under', 'again', 'further',
  'of', 'into', 'as', 'until', 'while', 'among', 'within', 'without',
  'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there',
  'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some',
  'such', 'only', 'own', 'same', 'much', 'many', 'enough', 'every',
  'once', 'twice', 'already', 'always', 'never', 'often', 'still',
  'because', 'since', 'although', 'though', 'however', 'therefore',
  'either', 'neither', 'nor', 'rather', 'per', 'via',
  'don', 'doesn', 'didn', 'won', 'wouldn', 'couldn', 'shouldn',
  'isn', 'aren', 'wasn', 'weren', 'hasn', 'haven', 'hadn',
]);

/** Tokenize text: lowercase, split on non-word chars, filter empty. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter(Boolean);
}

/** Remove common English stopwords from token array. */
export function removeStopwords(tokens: string[]): string[] {
  return tokens.filter((t) => !STOPWORDS.has(t));
}
