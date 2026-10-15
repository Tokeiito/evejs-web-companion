// searchUtil.IsMatch (eve/client/script/ui/util/searchUtil.py 383 to 427): whether a name matches what was typed, by
// the search's own four ways (search/const.py MatchBy). The client's windows match what they hold themselves by it,
// as the mail search window does its lists, its corporation and its alliance.

/** search/const.py MatchBy. */
export const MATCH_BY = Object.freeze({ partialTerms: 0, exactTerms: 1, exactPhrase: 2, exactPhraseOnly: 3 });
/** search/const.py min_wildcard_length: the least a partial term may be. */
export const MIN_WILDCARD_LENGTH = 3;

/** Python's str.split(): the words between runs of whitespace, none for blank text. */
const words = (text: string): string[] => text.split(/\s+/).filter((word) => word !== "");

/**
 * IsMatch(searchStr, candidate, exact). Partial terms where no term is of three letters or more are taken as exact
 * terms (the client's languages that are not concise: the page has no other). Partial terms: each term the start
 * of a word of the name. Exact terms: each term a word of it. Exact phrase: the terms, in order, words of it one
 * after another. Only the exact phrase: the whole name. Case is not minded, nor whitespace at either end.
 */
export function isSearchMatch(searchStr: string, candidate: string, exact: number): boolean {
  let by = exact;
  if (by === MATCH_BY.partialTerms && !words(searchStr).some((term) => term.length >= MIN_WILDCARD_LENGTH)) {
    by = MATCH_BY.exactTerms;
  }
  const typed = searchStr.toLowerCase().trim();
  const name = candidate.toLowerCase().trim();
  const nameWords = words(name);
  if (by === MATCH_BY.partialTerms) {
    return words(typed).every((term) => nameWords.some((word) => word.startsWith(term)));
  }
  if (by === MATCH_BY.exactTerms) {
    return words(typed).every((term) => nameWords.includes(term));
  }
  if (by === MATCH_BY.exactPhrase) {
    const terms = words(typed);
    for (let start = 0; start + terms.length <= nameWords.length; start += 1) {
      if (terms.every((term, at) => nameWords[start + at] === term)) {
        return true;
      }
    }
    return false;
  }
  if (by === MATCH_BY.exactPhraseOnly) {
    return typed === name;
  }
  return false;
}
