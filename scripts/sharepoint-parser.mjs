import { parentPort, workerData } from 'node:worker_threads';
import { posix } from 'node:path';
import yauzl from 'yauzl';
import { XMLParser } from 'fast-xml-parser';
import { convert } from 'html-to-text';

const fail = (code = 'INVALID_FORMAT') => {
  throw new Error(code);
};
const xml = new XMLParser({
  ignoreAttributes: false,
  processEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
});
const list = (value) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
const text = (value) =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : value && typeof value === 'object'
      ? Object.entries(value)
          .filter(([key]) => !key.startsWith('@_'))
          .map(([, v]) => list(v).map(text).join(''))
          .join('')
      : '';
async function unzip(bytes) {
  const archive = await new Promise((resolve, reject) =>
    yauzl.fromBuffer(
      Buffer.from(bytes),
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (err, zip) => (err ? reject(err) : resolve(zip)),
    ),
  );
  const files = new Map();
  let total = 0;
  try {
    await new Promise((resolve, reject) => {
      archive.on('error', reject);
      archive.on('end', resolve);
      archive.on('entry', (entry) => {
        void (async () => {
          const name = entry.fileName;
          if (
            files.has(name) ||
            files.size >= 5000 ||
            entry.generalPurposeBitFlag & 1 ||
            /(?:^|\/)\.\.(?:\/|$)|^\/|\\|vbaproject|activex|embeddings\/|\.bin$|\.exe$/i.test(
              name,
            )
          )
            fail('UNSAFE_FILE');
          total += entry.uncompressedSize;
          if (
            total > 100 * 1024 * 1024 ||
            entry.uncompressedSize > 30 * 1024 * 1024 ||
            entry.uncompressedSize > Math.max(1, entry.compressedSize) * 200
          )
            fail('UNSAFE_FILE');
          const stream = await new Promise((res, rej) =>
            archive.openReadStream(entry, (err, s) =>
              err ? rej(err) : res(s),
            ),
          );
          const chunks = [];
          let size = 0;
          for await (const chunk of stream) {
            size += chunk.length;
            if (size > 30 * 1024 * 1024) fail('UNSAFE_FILE');
            chunks.push(chunk);
          }
          const data = Buffer.concat(chunks);
          if (
            /\.(xml|rels)$/i.test(name) &&
            /<!\s*(DOCTYPE|ENTITY)|macroEnabled|oleObject|altChunk/i.test(
              data.toString('utf8'),
            )
          )
            fail('UNSAFE_FILE');
          files.set(name, data);
          archive.readEntry();
        })().catch(reject);
      });
      archive.readEntry();
    });
  } finally {
    archive.close();
  }
  return files;
}
function readXml(files, name) {
  const bytes = files.get(name);
  if (!bytes) fail();
  return xml.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
function paragraphs(node) {
  if (!node || typeof node !== 'object') return '';
  const output = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'a:p') for (const p of list(value)) output.push(text(p));
    else if (!key.startsWith('@_'))
      for (const child of list(value)) {
        const found = paragraphs(child);
        if (found) output.push(found);
      }
  }
  return output.join('\n');
}
function csv(input) {
  const first = input.split(/\r?\n/, 1)[0];
  const delimiter =
    (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0)
      ? ';'
      : ',';
  const rows = [];
  let row = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
    if (rows.length > 100000 || row.length > 1000 || cell.length > 1000000)
      fail('TEXT_LIMIT');
  }
  if (quoted) fail();
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows[0] ?? [];
  return rows
    .map(
      (r, n) =>
        `Fila ${n + 1}: ${r.map((v, i) => `${n ? headers[i] || `Columna ${i + 1}` : `Columna ${i + 1}`}: ${v}`).join(' | ')}`,
    )
    .join('\n');
}
async function extract() {
  const bytes = new Uint8Array(workerData.bytes);
  const format = workerData.format;
  if (['csv', 'md', 'html'].includes(format)) {
    let result = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (result.length > 1000000) fail('TEXT_LIMIT');
    if (format === 'csv') result = csv(result);
    if (format === 'html')
      result = convert(result, {
        wordwrap: false,
        limits: { maxInputLength: 1000000 },
        selectors: [
          { selector: 'script', format: 'skip' },
          { selector: 'style', format: 'skip' },
          { selector: 'img', format: 'skip' },
          { selector: 'a', options: { ignoreHref: true } },
        ],
      });
    return { text: result, images: [] };
  }
  const files = await unzip(bytes);
  const allMedia = [...files].filter(([name]) =>
    /^(?:word|xl|ppt)\/media\/[^/]+$/i.test(name),
  );
  if (allMedia.some(([name]) => !/\.(png|jpe?g|bmp|tiff?)$/i.test(name)))
    fail('UNSUPPORTED_EMBEDDED_IMAGE');
  const media = allMedia;
  if (media.length > 20) fail('EMBEDDED_IMAGE_LIMIT');
  const images = media.map(([name, data]) => ({
    name,
    bytes: new Uint8Array(data),
  }));
  if (format === 'docx') return { text: '', images };
  if (format === 'xlsx') {
    const workbook = readXml(files, 'xl/workbook.xml').workbook;
    const rels = list(
      readXml(files, 'xl/_rels/workbook.xml.rels').Relationships?.Relationship,
    );
    const strings = files.has('xl/sharedStrings.xml')
      ? list(readXml(files, 'xl/sharedStrings.xml').sst?.si).map(text)
      : [];
    const output = [];
    let cells = 0;
    for (const sheet of list(workbook?.sheets?.sheet)) {
      const rel = rels.find((r) => r['@_Id'] === sheet['@_r:id']);
      if (!rel || rel['@_TargetMode'] === 'External') fail('UNSAFE_FILE');
      const target = String(rel['@_Target'] ?? '');
      const file = target.startsWith('/')
        ? target.slice(1)
        : posix.normalize(`xl/${target}`);
      if (!file.startsWith('xl/worksheets/')) fail('UNSAFE_FILE');
      output.push(`# Hoja: ${sheet['@_name']}`);
      const rows = list(readXml(files, file).worksheet?.sheetData?.row);
      const headers = new Map();
      for (const [index, row] of rows.entries()) {
        const values = [];
        for (const cell of list(row.c)) {
          if (++cells > 100000) fail('TEXT_LIMIT');
          const address = String(cell['@_r'] ?? '');
          const column = address.replace(/\d/g, '');
          let value =
            cell['@_t'] === 's'
              ? strings[Number(cell.v)]
              : cell['@_t'] === 'inlineStr'
                ? text(cell.is)
                : text(cell.v);
          if (cell.f !== undefined && cell.v === undefined)
            value = '[fórmula sin valor guardado; requiere revisión]';
          if (index === 0) headers.set(column, value);
          const header = index > 0 ? headers.get(column) : '';
          values.push(
            `${header ? `${header} ` : ''}(${address}): ${value ?? ''}`,
          );
        }
        output.push(`Fila ${row['@_r'] ?? index + 1}: ${values.join(' | ')}`);
      }
    }
    return { text: output.join('\n\n'), images };
  }
  if (format === 'pptx') {
    const output = [];
    const slides = [...files.keys()]
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort(
        (a, b) =>
          Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]),
      );
    if (!slides.length || slides.length > 300) fail('TEXT_LIMIT');
    for (const slide of slides) {
      const n = Number(slide.match(/slide(\d+)/)[1]);
      output.push(`# Diapositiva ${n}\n${paragraphs(readXml(files, slide))}`);
      const relPath = `ppt/slides/_rels/slide${n}.xml.rels`;
      if (files.has(relPath))
        for (const rel of list(
          readXml(files, relPath).Relationships?.Relationship,
        )) {
          if (
            String(rel['@_Type']).endsWith('/notesSlide') &&
            rel['@_TargetMode'] !== 'External'
          ) {
            const notes = posix.normalize(`ppt/slides/${rel['@_Target']}`);
            if (!notes.startsWith('ppt/notesSlides/')) fail('UNSAFE_FILE');
            output.push(
              `Notas de diapositiva ${n}:\n${paragraphs(readXml(files, notes))}`,
            );
          }
        }
    }
    return { text: output.join('\n\n'), images };
  }
  fail();
}
try {
  const result = await extract();
  if (result.text.length > 1000000) fail('TEXT_LIMIT');
  parentPort.postMessage(result);
} catch (error) {
  parentPort.postMessage({
    error: [
      'UNSAFE_FILE',
      'TEXT_LIMIT',
      'EMBEDDED_IMAGE_LIMIT',
      'UNSUPPORTED_EMBEDDED_IMAGE',
    ].includes(error.message)
      ? error.message
      : 'INVALID_FORMAT',
  });
}
