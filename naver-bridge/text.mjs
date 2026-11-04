// Pure text helpers for the bridge (kept free of Playwright so they can be unit-tested).

// Markdown body -> clean plain text for Naver SmartEditor.
export function markdownToPlain(src) {
  const out = String(src ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !/^\s*(```|~~~)/.test(line))
    .map((line) => {
      let s = line;
      s = s.replace(/^\s{0,3}#{1,6}\s+/, '');                 // "## 제목" -> "제목" (own line)
      s = s.replace(/^(\s*)[-*]\s+/, '$1• ');                  // list items
      s = s.replace(/`([^`]*)`/g, '$1');                       // inline code
      s = s.replace(/!?\[([^\]]*)\]\(([^)\s]+)\)/g, '$1 ($2)'); // [text](url) -> text (url)
      s = s.replace(/\*\*([^*]+)\*\*/g, '$1');                 // bold
      s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1$2'); // italic
      return s.replace(/\s+$/, '');
    })
    .join('\n');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

// Plain body + 출처 section built from post.sources (one source per line).
export function buildPostText(post) {
  let text = markdownToPlain(post.body);
  const sources = String(post.sources ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (sources.length) text += `\n\n출처\n${sources.join('\n')}`;
  return text;
}
