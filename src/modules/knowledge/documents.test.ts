import { describe, expect, it } from 'vitest';
import {
  validateDocument,
  validateDocumentBytes,
  documentLimits,
  documentMimeTypes,
} from './documents';
import { extractDocument } from './extract-document';
import { textPdf, wordDocx } from '../../../tests/fixtures/documents';

describe('MAIL-036 archivos y extracción real', () => {
  it.each([
    ['a.exe', 'text/plain', 1],
    ['../a.txt', 'text/plain', 1],
    ['a.txt', 'application/pdf', 1],
    ['a.txt', 'text/plain', 0],
    ['a.txt', 'text/plain', documentLimits.maxBytes + 1],
    ['a\u202etxt.pdf', 'application/pdf', 1],
  ])('rechaza metadatos inválidos: %s', (name, type, size) => {
    expect(() => validateDocument({ name, type, size })).toThrow();
  });
  it('admite extensiones sin distinguir mayúsculas y valida la firma', () => {
    expect(
      validateDocument({
        name: 'Tarifas.PDF',
        type: documentMimeTypes.pdf,
        size: 100,
      }),
    ).toBe('pdf');
    expect(() => validateDocumentBytes(Buffer.from('falso'), 'pdf')).toThrow(
      'INVALID_FORMAT',
    );
    expect(() =>
      validateDocumentBytes(Buffer.from('PK\x03\x04binary'), 'txt'),
    ).toThrow('INVALID_FORMAT');
    expect(() =>
      validateDocumentBytes(Buffer.from([0xff, 0xfe]), 'txt'),
    ).toThrow('INVALID_FORMAT');
    expect(() => validateDocumentBytes(Buffer.from('hola\x00'), 'txt')).toThrow(
      'INVALID_FORMAT',
    );
  });
  it('extrae texto UTF-8 con acentos y saltos de línea', async () => {
    expect(
      await extractDocument(Buffer.from('Información\r\nTarifa: 125 €'), 'txt'),
    ).toBe('Información\nTarifa: 125 €');
  });
  it('extrae un PDF real', async () => {
    expect(await extractDocument(textPdf(), 'pdf')).toContain('125 EUR');
  });
  it('extrae un DOCX real', async () => {
    expect(await extractDocument(await wordDocx(), 'docx')).toContain(
      'Procedimiento de soporte',
    );
  });
  it.each(['pdf', 'docx'] as const)('rechaza %s corrupto', async (format) => {
    await expect(
      extractDocument(Buffer.from('contenido corrupto'), format),
    ).rejects.toThrow('INVALID_FORMAT');
  });
  it('rechaza PDF sin texto y TXT vacío', async () => {
    await expect(extractDocument(textPdf(''), 'pdf')).rejects.toThrow(
      'NO_TEXT',
    );
    await expect(extractDocument(Buffer.from(' \n '), 'txt')).rejects.toThrow(
      'NO_TEXT',
    );
  });
  it('limita el texto extraído', async () => {
    await expect(
      extractDocument(Buffer.from('a'.repeat(1_000_001)), 'txt'),
    ).rejects.toThrow('TEXT_LIMIT');
  });
  it.each<Record<string, string>>([
    { 'word/vbaProject.bin': 'macro' },
    {
      'word/extra.xml':
        '<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]><x>&y;</x>',
    },
    { 'word/extra.xml': 'a'.repeat(2_000_000) },
  ])('rechaza macros, entidades y bombas de compresión', async (extra) => {
    await expect(
      extractDocument(await wordDocx(extra), 'docx'),
    ).rejects.toThrow('UNSAFE_FILE');
  });
});
