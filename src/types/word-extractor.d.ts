/**
 * Minimal ambient types for `word-extractor` (legacy binary .doc reader).
 * The package ships no types; we use only `extract()` and `getBody()`.
 */
declare module "word-extractor" {
  class Document {
    getBody(): string;
    getFootnotes(): string;
    getEndnotes(): string;
    getHeaders(): string;
    getFooters(): string;
  }
  class WordExtractor {
    extract(source: string | Buffer): Promise<Document>;
  }
  export = WordExtractor;
}
