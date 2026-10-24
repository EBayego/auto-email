import { DocumentError } from './documents';

export const documentIndexerVersion = 'mail037-v1';
export type ExtractedDocument = {
  text: string;
  pages?: { text: string; page: number }[];
};
export type KnowledgeChunk = {
  position: number;
  section: string;
  content: string;
  start_offset: number;
  end_offset: number;
  page_start: number | null;
  page_end: number | null;
};
export type DocumentIndex = {
  normalized_text: string;
  chunks: KnowledgeChunk[];
  indexer_version: typeof documentIndexerVersion;
};
export type KnowledgeSearchMatch = Pick<
  KnowledgeChunk,
  'section' | 'content' | 'page_start' | 'page_end'
> & {
  chunk_id: string;
  document_id: string;
  document_name: string;
  version: number;
};
const maxChunk = 2000;
const length = (text: string) => Array.from(text).length;

function clean(text: string) {
  return text
    .normalize('NFC')
    .replace(/\p{Cc}/gu, (character) =>
      '\n\r\t'.includes(character) ? character : '',
    )
    .replace(/\r\n?/g, '\n')
    .replace(/\u00ad\n?/g, '')
    .replace(/[\u200b\ufeff]/g, '')
    .replace(/ﬀ/g, 'ff')
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n');
}
function heading(line: string): { level: number; title: string } | null {
  const markdown = /^(#{1,6})\s+(.{1,200})$/.exec(line);
  if (markdown) return { level: markdown[1].length, title: markdown[2] };
  const numbered = /^(\d+(?:\.\d+)*)(?:[.)])?\s+(\p{Lu}.{1,120})$/u.exec(line);
  if (numbered && !/[.!?;:]$/.test(line))
    return { level: Math.min(6, numbered[1].split('.').length), title: line };
  if (
    line.length >= 3 &&
    line.length <= 100 &&
    /\p{Lu}/u.test(line) &&
    !/\p{Ll}/u.test(line) &&
    !/[.!?;]$/.test(line)
  )
    return { level: 1, title: line };
  return null;
}

export function buildDocumentIndex(document: ExtractedDocument): DocumentIndex {
  if (!document.text || document.text.length > 1_000_000)
    throw new DocumentError('TEXT_LIMIT');
  const pages = (document.pages ?? [{ text: document.text, page: 0 }]).map(
    (p) => ({ ...p, lines: clean(p.text).split('\n') }),
  );
  // Only repeated page margins are boilerplate. Equal text in different sections remains evidence.
  const margins = new Map<string, number>();
  for (const page of pages) {
    if (page.lines.filter(Boolean).length < 4) continue;
    const candidates = new Set(
      [...page.lines.slice(0, 2), ...page.lines.slice(-2)].filter(
        (line) => line.length > 3 && line.length < 160,
      ),
    );
    for (const line of candidates)
      margins.set(line, (margins.get(line) ?? 0) + 1);
  }
  const repeated = new Set(
    [...margins]
      .filter(([, count]) => count >= 3 && count >= pages.length * 0.6)
      .map(([line]) => line),
  );
  const blocks: { text: string; page: number }[] = [];
  for (const page of pages) {
    const lines = page.lines.filter((line, i) => {
      const margin = i < 2 || i >= page.lines.length - 2;
      return !(
        margin &&
        (repeated.has(line) ||
          (page.page > 0 &&
            /^(?:p[aá]gina\s*)?\d{1,4}(?:\s*(?:\/|de)\s*\d{1,4})?$/i.test(
              line,
            )))
      );
    });
    const paragraphs = lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .split('\n\n');
    let previous = '';
    for (const paragraph of paragraphs) {
      if (paragraph && !(paragraph.length >= 40 && paragraph === previous))
        blocks.push({ text: paragraph, page: page.page });
      previous = paragraph;
    }
  }
  const normalized = blocks.map((b) => b.text).join('\n\n');
  if (!/[\p{L}\p{N}]/u.test(normalized)) throw new DocumentError('NO_TEXT');
  const chars = Array.from(normalized);
  if (chars.length > 1_000_000) throw new DocumentError('TEXT_LIMIT');
  const ranges: { start: number; end: number; page: number }[] = [];
  const sections: { start: number; section: string }[] = [];
  const titles: string[] = [];
  let offset = 0;
  for (const block of blocks) {
    if (block.page > 0) {
      const previous = ranges.at(-1);
      if (previous?.page === block.page)
        previous.end = offset + length(block.text);
      else
        ranges.push({
          start: offset,
          end: offset + length(block.text),
          page: block.page,
        });
    }
    for (const line of block.text.split('\n')) {
      const h = heading(line);
      if (h) {
        titles.length = h.level - 1;
        titles[h.level - 1] = h.title;
        sections.push({
          start: offset,
          section: Array.from(titles.filter(Boolean).join(' > '))
            .slice(0, 500)
            .join(''),
        });
      }
      offset += length(line) + 1;
    }
    offset += 1;
  }
  if (!sections.length || sections[0].start > 0)
    sections.unshift({ start: 0, section: '' });
  const chunks: KnowledgeChunk[] = [];
  sections.forEach((section, index) => {
    const end = sections[index + 1]?.start ?? chars.length;
    let start = section.start;
    while (start < end) {
      while (start < end && /\s/u.test(chars[start])) start++;
      if (start >= end) break;
      let stop = Math.min(start + maxChunk, end);
      if (stop < end) {
        const window = chars.slice(start, stop).join('');
        const boundary = [/\n\n/gu, /[.!?]\s+/gu, /\s+/gu]
          .map((pattern) =>
            [...window.matchAll(pattern)]
              .reverse()
              .find((m) => length(window.slice(0, m.index!)) >= 700),
          )
          .find(Boolean);
        if (boundary)
          stop =
            start +
            length(window.slice(0, boundary.index! + boundary[0].length));
      }
      let trimmedEnd = stop;
      while (trimmedEnd > start && /\s/u.test(chars[trimmedEnd - 1]))
        trimmedEnd--;
      const covered = ranges.filter(
        (r) => r.start < trimmedEnd && r.end > start && r.page > 0,
      );
      chunks.push({
        position: chunks.length,
        section: section.section,
        content: chars.slice(start, trimmedEnd).join(''),
        start_offset: start,
        end_offset: trimmedEnd,
        page_start: covered[0]?.page ?? null,
        page_end: covered.at(-1)?.page ?? null,
      });
      if (chunks.length > 2000) throw new DocumentError('TEXT_LIMIT');
      start = stop;
    }
  });
  return {
    normalized_text: normalized,
    chunks,
    indexer_version: documentIndexerVersion,
  };
}
