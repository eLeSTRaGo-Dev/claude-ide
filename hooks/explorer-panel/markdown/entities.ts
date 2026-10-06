// I11 entities: a table of common named entities plus numeric references.

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '­',
  ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '‌', zwj: '‍',
  copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–', minus: '−',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›', bull: '•', middot: '·',
  deg: '°', plusmn: '±', times: '×', divide: '÷', frac12: '½', frac14: '¼', frac34: '¾',
  sup1: '¹', sup2: '²', sup3: '³', micro: 'µ', para: '¶', sect: '§', ordf: 'ª', ordm: 'º',
  euro: '€', pound: '£', yen: '¥', cent: '¢', curren: '¤', brvbar: '¦', uml: '¨',
  macr: '¯', acute: '´', cedil: '¸', iexcl: '¡', iquest: '¿', not: '¬',
  dagger: '†', Dagger: '‡', permil: '‰', prime: '′', Prime: '″', oline: '‾', frasl: '⁄',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', crarr: '↵',
  lArr: '⇐', rArr: '⇒', uArr: '⇑', dArr: '⇓', hArr: '⇔',
  le: '≤', ge: '≥', ne: '≠', asymp: '≈', equiv: '≡', infin: '∞', sum: '∑', prod: '∏',
  radic: '√', part: '∂', nabla: '∇', isin: '∈', notin: '∉', ni: '∋', cap: '∩', cup: '∪',
  and: '∧', or: '∨', forall: '∀', exist: '∃', empty: '∅', sub: '⊂', sup: '⊃', sube: '⊆',
  supe: '⊇', int: '∫', there4: '∴', sim: '∼', cong: '≅', prop: '∝', ang: '∠', perp: '⊥',
  sdot: '⋅', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', lang: '⟨', rang: '⟩',
  loz: '◊', spades: '♠', clubs: '♣', hearts: '♥', diams: '♦', check: '✓', cross: '✗',
  star: '☆', starf: '★', hyphen: '‐', tab: '\t', Tab: '\t', NewLine: '\n',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο',
  pi: 'π', rho: 'ρ', sigma: 'σ', sigmaf: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ',
  psi: 'ψ', omega: 'ω', Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ',
  Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å', AElig: 'Æ',
  Ccedil: 'Ç', Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í',
  Icirc: 'Î', Iuml: 'Ï', Ntilde: 'Ñ', Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ',
  Ouml: 'Ö', Oslash: 'Ø', Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü', Yacute: 'Ý',
  szlig: 'ß', agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å',
  aelig: 'æ', ccedil: 'ç', egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë', igrave: 'ì',
  iacute: 'í', icirc: 'î', iuml: 'ï', ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô',
  otilde: 'õ', ouml: 'ö', oslash: 'ø', ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü',
  yacute: 'ý', yuml: 'ÿ', OElig: 'Œ', oelig: 'œ', Scaron: 'Š', scaron: 'š', fnof: 'ƒ',
}

/** One code point from a numeric reference; 0, surrogates and out-of-range become U+FFFD. */
function fromCode(code: number): string {
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�'
  return String.fromCodePoint(code)
}

/**
 * Decodes one entity's body (between `&` and `;`): `copy`, `#169`, `#xA9`.
 * Returns undefined for an unknown name (the caller keeps it literal).
 */
export function decodeEntity(body: string): string | undefined {
  if (body.charCodeAt(0) === 35 /* # */) {
    const hex = body[1] === 'x' || body[1] === 'X'
    const digits = body.slice(hex ? 2 : 1)
    if (!digits || digits.length > (hex ? 6 : 7)) return undefined
    if (!(hex ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/).test(digits)) return undefined
    return fromCode(parseInt(digits, hex ? 16 : 10))
  }
  return Object.prototype.hasOwnProperty.call(NAMED, body) ? NAMED[body] : undefined
}

const ESC_OR_ENTITY =
  /\\([!-\/:-@\[-`{-~])|&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g

/** Backslash escapes (I10) and entities (I11) in link destinations, titles and info strings. */
export function unescapeString(s: string): string {
  if (s.indexOf('\\') < 0 && s.indexOf('&') < 0) return s
  return s.replace(ESC_OR_ENTITY, (m, esc: string | undefined, ent: string | undefined) =>
    esc !== undefined ? esc : decodeEntity(ent!) ?? m,
  )
}
