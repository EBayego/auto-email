import { describe, expect, it } from 'vitest';
import { buildDocumentIndex } from './document-index';
import { extractDocumentContent } from './extract-document';
import { wordDocx, textPdf } from '../../../tests/fixtures/documents';

describe('MAIL-037 normalización, secciones y ubicaciones', () => {
  it('limpia espacios, ligaduras, guiones blandos y párrafos duplicados sin eliminar hechos repetidos en otras secciones', () => {
    const repeated =
      'Este es un párrafo de extracción duplicado que contiene una condición vigente.';
    const result = buildDocumentIndex({
      text: `# Tarifas\r\n\r\nInformación\u00ad\nactual:  125 € y oﬁcina.\n\n${repeated}\n\n${repeated}\n\n# Otras condiciones\n\n${repeated}`,
    });
    expect(result.normalized_text).toContain(
      'Informaciónactual: 125 € y oficina.',
    );
    expect(result.normalized_text.split(repeated)).toHaveLength(3);
    expect(result.chunks.map((c) => c.section)).toEqual([
      'Tarifas',
      'Otras condiciones',
    ]);
  });
  it('retira encabezados, pies y números repetidos solo en los márgenes PDF', () => {
    const pages = Array.from({ length: 3 }, (_, i) => ({
      page: i + 1,
      text: `Manual de empresa\n\n# Sección ${i + 1}\n\nInformación única de la sección ${i + 1}.\n\nUso interno\nPágina ${i + 1} de 3`,
    }));
    const result = buildDocumentIndex({
      text: pages.map((p) => p.text).join('\n\n'),
      pages,
    });
    expect(result.normalized_text).not.toMatch(
      /Manual de empresa|Uso interno|Página/,
    );
    expect(result.chunks.map((c) => [c.page_start, c.page_end])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });
  it('fragmenta documentos largos respetando secciones y permite reconstruir cada fragmento por sus offsets Unicode', () => {
    const text = `# Tarifas\n\n${'Consulta de información: 125 €. 😀 '.repeat(180)}\n\n## Descuentos\n\n${'El descuento vigente es de diez euros. '.repeat(100)}`;
    const result = buildDocumentIndex({ text });
    expect(result.chunks.length).toBeGreaterThan(4);
    expect(
      result.chunks.some((c) => c.section === 'Tarifas > Descuentos'),
    ).toBe(true);
    for (const chunk of result.chunks) {
      expect(Array.from(chunk.content).length).toBeLessThanOrEqual(2000);
      expect(
        Array.from(result.normalized_text)
          .slice(chunk.start_offset, chunk.end_offset)
          .join(''),
      ).toBe(chunk.content);
      expect(chunk.content).not.toMatch(/[\ud800-\udbff]$/);
    }
    expect(
      result.chunks
        .map((c) => c.content)
        .join(' ')
        .replace(/\s/g, ''),
    ).toBe(text.replace(/\s/g, ''));
  });
  it('conserva títulos numerados y encabezados de texto', () => {
    const result = buildDocumentIndex({
      text: '1. Precios\n\nConsulta: 125 €.\n\n1.1 Descuentos\n\nDescuento: 10 €.\n\nSOPORTE\n\nAtención por correo.',
    });
    expect(result.chunks.map((c) => c.section)).toEqual([
      '1. Precios',
      '1. Precios > 1.1 Descuentos',
      'SOPORTE',
    ]);
  });
  it('es determinista y acota documentos sin espacios', () => {
    const input = { text: 'x'.repeat(10_000) };
    expect(buildDocumentIndex(input)).toEqual(buildDocumentIndex(input));
    expect(buildDocumentIndex(input).chunks).toHaveLength(5);
    expect(() => buildDocumentIndex({ text: 'a'.repeat(1_000_001) })).toThrow(
      'TEXT_LIMIT',
    );
    expect(() => buildDocumentIndex({ text: '   ' })).toThrow('NO_TEXT');
  });
  it('extrae la estructura DOCX y la página PDF desde los parsers reales', async () => {
    const bytes = await wordDocx({
      'word/document.xml':
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Tarifas vigentes</w:t></w:r></w:p><w:p><w:r><w:t>Consulta: 125 EUR.</w:t></w:r></w:p></w:body></w:document>',
      'word/styles.xml':
        '<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>',
    });
    expect(
      buildDocumentIndex(await extractDocumentContent(bytes, 'docx')).chunks[0]
        .section,
    ).toBe('Tarifas vigentes');
    const pdfIndex = buildDocumentIndex(
      await extractDocumentContent(
        textPdf(undefined, 'Tarifas vigentes'),
        'pdf',
      ),
    );
    expect(pdfIndex.chunks[0].page_start).toBe(1);
    expect(pdfIndex.chunks[0].section).toBe('Tarifas vigentes');
  }, 15_000);
});
