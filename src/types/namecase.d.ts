/**
 * Ambient type shim for the untyped `namecase` package (a JavaScript port of
 * Perl's Lingua::EN::NameCase). The package ships no types and no
 * `@types/namecase` exists, so we declare its single default export here.
 *
 * The module uses a CommonJS `module.exports = fn`, hence `export =`; with
 * `esModuleInterop` enabled this is consumed as `import nameCase from "namecase"`.
 */
declare module "namecase" {
  /**
   * Fix the capitalization of a person's name (heuristic — handles Mc/Mac,
   * O'/D' particles, hyphenates, roman-numeral suffixes, etc.).
   */
  const nameCase: (input: string) => string;
  export = nameCase;
}
