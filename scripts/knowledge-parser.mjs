import { parentPort, workerData } from 'node:worker_threads';
import yauzl from 'yauzl';
import mammoth from 'mammoth';
import { convert } from 'html-to-text';

const maxText = 1_000_000;
function fail(code = 'INVALID_FORMAT') {
  throw new Error(code);
}

async function checkDocx(buffer) {
  const zip = await new Promise((resolve, reject) =>
    yauzl.fromBuffer(
      buffer,
      {
        lazyEntries: true,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (error, result) => (error ? reject(error) : resolve(result)),
    ),
  );
  const names = new Set();
  let total = 0;
  try {
    await new Promise((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry) => {
        void (async () => {
          const name = entry.fileName;
          if (
            names.has(name) ||
            names.size >= 1000 ||
            entry.generalPurposeBitFlag & 1 ||
            /(?:^|\/)\.\.(?:\/|$)|^\/|\\/.test(name) ||
            /vbaproject|embeddings\/|activex\/|\.bin$|\.exe$/i.test(name)
          )
            fail('UNSAFE_FILE');
          names.add(name);
          total += entry.uncompressedSize;
          if (
            total > 30 * 1024 * 1024 ||
            entry.uncompressedSize > 10 * 1024 * 1024 ||
            entry.uncompressedSize > Math.max(1, entry.compressedSize) * 200
          )
            fail('UNSAFE_FILE');
          // Read XML only, never write paths to disk or resolve external entities/relationships.
          if (/\.(?:xml|rels)$/i.test(name)) {
            const stream = await new Promise((res, rej) =>
              zip.openReadStream(entry, (err, s) => (err ? rej(err) : res(s))),
            );
            const chunks = [];
            let size = 0;
            for await (const chunk of stream) {
              size += chunk.length;
              if (size > 10 * 1024 * 1024) {
                stream.destroy();
                fail('UNSAFE_FILE');
              }
              chunks.push(chunk);
            }
            const xml = new TextDecoder('utf-8', { fatal: true }).decode(
              Buffer.concat(chunks),
            );
            if (
              name === '[Content_Types].xml' &&
              !xml.includes(
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
              )
            )
              fail();
            if (
              /<!\s*(?:DOCTYPE|ENTITY)|macroEnabled|altChunk|oleObject/i.test(
                xml,
              )
            )
              fail('UNSAFE_FILE');
          }
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
    if (
      !names.has('[Content_Types].xml') ||
      !names.has('word/document.xml') ||
      !names.has('_rels/.rels')
    )
      fail();
  } finally {
    zip.close();
  }
}

async function extract() {
  const bytes = new Uint8Array(workerData.bytes);
  if (workerData.format === 'txt')
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  if (workerData.format === 'docx') {
    const buffer = Buffer.from(bytes);
    await checkDocx(buffer);
    const result = await mammoth.convertToHtml(
      { buffer },
      {
        externalFileAccess: false,
        convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
      },
    );
    if (result.value.length > 10_000_000) fail('TEXT_LIMIT');
    const text = convert(result.value, {
      wordwrap: false,
      limits: { maxInputLength: 10_000_000 },
      selectors: [
        { selector: 'img', format: 'skip' },
        { selector: 'a', options: { ignoreHref: true } },
        ...[1, 2, 3, 4, 5, 6].map((level) => ({
          selector: `h${level}`,
          format: 'documentHeading',
          options: { level },
        })),
      ],
      formatters: {
        documentHeading: (element, walk, builder, options) => {
          builder.openBlock({ leadingLineBreaks: 2 });
          builder.addInline('#'.repeat(options.level) + ' ');
          walk(element.children, builder);
          builder.closeBlock({ trailingLineBreaks: 2 });
        },
      },
    });
    return { text };
  }
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: true,
    verbosity: 0,
    maxImageSize: 0,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
  });
  try {
    const pdf = await loading.promise;
    if (pdf.numPages > 300) fail('TEXT_LIMIT');
    if ((await pdf.hasJSActions()) || (await pdf.getAttachments()))
      fail('UNSAFE_FILE');
    const pages = [];
    let length = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const lines = [],
        sizes = new Map();
      let line = { text: '', height: 0 };
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const height = Math.round(
          Math.abs(item.height || item.transform[3] || 0),
        );
        if (item.str.trim())
          sizes.set(height, (sizes.get(height) ?? 0) + item.str.length);
        line.text += item.str + ' ';
        line.height = Math.max(line.height, height);
        if (item.hasEOL) {
          lines.push(line);
          line = { text: '', height: 0 };
        }
      }
      if (line.text.trim()) lines.push(line);
      const bodySize = [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 12;
      const text = lines
        .map((l) => {
          const value = l.text.trim();
          const isHeading =
            bodySize > 0 &&
            l.height >= bodySize * 1.3 &&
            value.length <= 200 &&
            !/[.!?;]$/.test(value);
          return (
            (isHeading ? (l.height >= bodySize * 1.5 ? '# ' : '## ') : '') +
            value
          );
        })
        .join('\n');
      length += text.length;
      if (length > maxText) fail('TEXT_LIMIT');
      pages.push({ text, page: n });
      page.cleanup();
    }
    return { text: pages.map((p) => p.text).join('\n\n'), pages };
  } finally {
    await loading.destroy();
  }
}

try {
  const document = await extract();
  const text = document.text
    .replace(/\r\n?/g, '\n')
    .split(String.fromCharCode(0))
    .join('')
    .trim();
  if (!text || !/[\p{L}\p{N}]/u.test(text)) fail('NO_TEXT');
  if (text.length > maxText) fail('TEXT_LIMIT');
  parentPort.postMessage({ text, pages: document.pages });
} catch (error) {
  parentPort.postMessage({
    error: ['NO_TEXT', 'TEXT_LIMIT', 'UNSAFE_FILE'].includes(error.message)
      ? error.message
      : 'INVALID_FORMAT',
  });
}
