/**
 * Minimal attribute-only XML reader for the institutional claim feed
 * (spec §2.1, U2). Deliberately narrow: attributes on elements, repeating
 * children, no namespaces, no CDATA, no mixed (text + element) content —
 * exactly this feed's shape. Not a general-purpose XML library; do not
 * extend it to be one.
 */

export interface XmlElement {
  tag: string;
  attrs: Record<string, string>;
  children: XmlElement[];
}

// Matches either an opening tag (capturing its name, its raw attribute
// string, and an optional self-closing `/`) or a closing tag. Attribute
// values are matched explicitly as quoted spans so a `>` inside a quoted
// value can never be mistaken for the tag's end.
const TAG_RE =
  /<([a-zA-Z_][\w:-]*)((?:\s+[a-zA-Z_][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/)?>|<\/([a-zA-Z_][\w:-]*)\s*>/g;

const ATTR_RE = /([a-zA-Z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(raw: string): string {
  return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, ent: string) => {
    if (ent.startsWith('#x') || ent.startsWith('#X')) {
      const code = parseInt(ent.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (ent.startsWith('#')) {
      const code = parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[ent] ?? whole;
  });
}

function parseAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(attrString)) !== null) {
    const name = m[1];
    const raw = m[2] !== undefined ? m[2] : m[3];
    if (name === undefined || raw === undefined) continue;
    attrs[name] = decodeEntities(raw);
  }
  return attrs;
}

/**
 * Parses attribute-only XML into an element tree under a synthetic `#root`.
 * Comments and processing instructions are stripped first; there is no text
 * content to preserve given this feed's shape.
 */
export function parseXml(xml: string): XmlElement {
  const stripped = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
  const root: XmlElement = { tag: '#root', attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(stripped)) !== null) {
    const openTag = m[1];
    const attrString = m[2];
    const selfClose = m[3];
    const closeTag = m[4];
    if (closeTag !== undefined) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (openTag === undefined) continue;
    const el: XmlElement = { tag: openTag, attrs: parseAttrs(attrString ?? ''), children: [] };
    const parent = stack[stack.length - 1];
    if (parent !== undefined) parent.children.push(el);
    if (selfClose === undefined) stack.push(el);
  }
  return root;
}
