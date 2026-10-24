import type { NextConfig } from 'next';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// The parser runs outside the Next.js bundle; include its complete dependency tree.
const parserFiles = new Set(['./scripts/knowledge-parser.mjs']);
const parserRequire = createRequire(import.meta.url);
function traceParserPackage(name: string, from = process.cwd()) {
  let manifest: string;
  try {
    manifest = parserRequire.resolve(`${name}/package.json`, { paths: [from] });
  } catch {
    let directory = path.dirname(
      parserRequire.resolve(name, { paths: [from] }),
    );
    while (
      !existsSync(path.join(directory, 'package.json')) ||
      JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
        .name !== name
    ) {
      const parent = path.dirname(directory);
      if (parent === directory)
        throw new Error(`No se pudo localizar el paquete ${name}`);
      directory = parent;
    }
    manifest = path.join(directory, 'package.json');
  }
  const directory = path.dirname(manifest);
  const glob = `./${path.relative(process.cwd(), directory).replaceAll('\\', '/')}/**`;
  if (parserFiles.has(glob)) return;
  parserFiles.add(glob);
  const metadata = JSON.parse(readFileSync(manifest, 'utf8'));
  for (const dependency of Object.keys(metadata.dependencies ?? {}))
    traceParserPackage(dependency, directory);
  for (const dependency of Object.keys(metadata.optionalDependencies ?? {})) {
    try {
      traceParserPackage(dependency, directory);
    } catch {
      /* Platform-specific optional dependency. */
    }
  }
}
for (const name of ['pdfjs-dist', 'mammoth', 'yauzl', 'html-to-text'])
  traceParserPackage(name);

const nextConfig: NextConfig = {
  // Las instrucciones propias del repositorio se incorporarán en MAIL-010.
  agentRules: false,
  turbopack: {
    root: process.cwd(),
  },
  serverExternalPackages: ['pdfjs-dist', 'mammoth', 'yauzl'],
  outputFileTracingIncludes: {
    '/api/knowledge/documents{,/**}': [...parserFiles],
  },
};

export default nextConfig;
