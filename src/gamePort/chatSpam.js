"use strict";

// The retail client's check of a line of chat for spam (chatutil/spam.py), and the list it checks against
// (carbonui/control/browser/sites.py).
//
// A chat window drops a line that is spam as it is put out, whoever said it, and does not send one
// (xmppchatclient/xmppchatwindow.py 353 to 359, 952 to 956). What is spam is a line that has in it one of the
// domains the server has flagged as blacklisted, however it is dressed up: the line and each domain are brought to
// one plain spelling first.
//
// ⚠ THE TABLE HERE IS NOT WHAT THE DECOMPILED PYTHON SHOWS. The decompile of chatutil/spam.py has the first
// string mangled and a list of numbers where the module has seventeen characters. What is here was read from
// the module's own compiled constants through the client's python27.dll (scripts/py27-oracle.py, marshal.loads of
// chatutil/spam.pyc), and the flow of IsSpam was checked against its bytecode, opcode by opcode.

/** _tfrom and _tto (spam.py 9 to 11): each of the first is written as the one under it. */
const WRITTEN_AS = new Map([..."1370,-_*+=^~@\u263b\u3002\u03bc\u03bf\u043c\u043e\u0441"].map((from, at) => [from, "leto...........momoc"[at]]));
/** The seventeen characters taken out of a line altogether (spam.py 12 to 13: each mapped to None). */
const TAKEN_OUT = new Set([..." \\|/!()[]{}<>\"'`\u00b4"]);

/**
 * NormalizeForSpam (spam.py 17 to 18): the text in lower case, each character through the table, the word 'dot'
 * made a dot, and two dots or more made one.
 */
function normalizeForSpam(text) {
  let translated = "";
  for (const character of String(text).toLowerCase()) {
    if (TAKEN_OUT.has(character)) continue;
    translated += WRITTEN_AS.has(character) ? WRITTEN_AS.get(character) : character;
  }
  return translated.replace(/dot/g, ".").replace(/\.{2,}/g, ".");
}

/** unicode.isalnum for one character: a letter or a number. */
const isAlnum = (character) => /^[\p{L}\p{N}]$/u.test(character);

/**
 * IsSpam (spam.py 27 to 47), given the taboos (GetTaboos, 21 to 24: each banned domain normalized). The first
 * taboo found in the normalized line settles it: where the line as it was written has the taboo too, and not at
 * its very start, the line is spam only if one of its occurrences does not follow a letter or a number; found at
 * the start, or only in the normalized line, it is spam.
 */
function isSpam(text, taboos) {
  const line = String(text);
  const normalized = normalizeForSpam(line);
  for (const taboo of taboos) {
    if (!normalized.includes(taboo)) continue;
    let at = line.indexOf(taboo);
    if (at > 0) {
      while (at > 0) {
        if (!isAlnum(line[at - 1])) return true;
        at = line.indexOf(taboo, at + 1);
      }
      return false;
    }
    return true;
  }
  return false;
}

/** sites.BLACKLIST_FLAG (sites.py 35). */
const BLACKLIST_FLAG = 1;

/** GetDomainOnly (sites.py 416 to 425): what follows '//' where there is one, without a leading '*', a leading '.' or a trailing '/*'. */
function domainOnly(url) {
  let domain = String(url);
  if (domain.includes("//")) domain = domain.split("//")[1];
  if (domain.startsWith("*")) domain = domain.slice(1);
  if (domain.startsWith(".")) domain = domain.slice(1);
  if (domain.endsWith("/*")) domain = domain.slice(0, -2);
  return domain;
}

/**
 * systemLists.bannedInChat (sites.py 427 to 432): of the flagged sites, each one flagged blacklisted, its domain
 * alone, where that is not empty. A site here is { siteFlag, siteUrl }.
 */
function bannedInChat(sites) {
  const banned = [];
  for (const site of Array.isArray(sites) ? sites : []) {
    if (!site || !(Number(site.siteFlag) & BLACKLIST_FLAG)) continue;
    const domain = domainOnly(site.siteUrl).trim();
    if (domain) banned.push(domain);
  }
  return banned;
}

module.exports = { bannedInChat, domainOnly, isSpam, normalizeForSpam };
