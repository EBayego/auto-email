import type { NextConfig } from 'next';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { assertNoPublicSecrets } from './src/config/env';

assertNoPublicSecrets();

// The parser runs outside the Next.js bundle; include its complete dependency tree.
const parserFiles = new Set([
  './scripts/knowledge-parser.mjs',
  './scripts/sharepoint-parser.mjs',
]);
const parserRequire = createRequire(import.meta.url);
function traceParserPackage(name: string, from = process.cwd()) {
  let manifest: string;
  try {
    manifest = parserRequire.resolve(`${name}/package.json`, { paths: [from] });
  } catch {
    let directory = path.resolve(from);
    while (
      !existsSync(path.join(directory, 'node_modules', name, 'package.json'))
    ) {
      const parent = path.dirname(directory);
      if (parent === directory)
        throw new Error(`No se pudo localizar el paquete ${name}`);
      directory = parent;
    }
    manifest = path.join(directory, 'node_modules', name, 'package.json');
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
for (const name of [
  'pdfjs-dist',
  'mammoth',
  'yauzl',
  'html-to-text',
  'fast-xml-parser',
])
  traceParserPackage(name);

const nextConfig: NextConfig = {
  output: 'standalone',
  // Las instrucciones propias del repositorio se incorporarán en MAIL-010.
  agentRules: false,
  poweredByHeader: false,
  logging: {
    incomingRequests: false,
    serverFunctions: false,
    browserToTerminal: false,
    fetches: { fullUrl: false },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy',
            value:
              "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self' https://accounts.google.com",
          },
          ...(process.env.APP_ENV === 'production' ||
          process.env.APP_ENV === 'staging'
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }]
            : []),
        ],
      },
    ];
  },
  turbopack: {
    root: process.cwd(),
  },
  serverExternalPackages: [
    'pdfjs-dist',
    'mammoth',
    'yauzl',
    'fast-xml-parser',
    '@azure/msal-node',
  ],
  outputFileTracingIncludes: {
    '/api/knowledge/documents{,/**}': [...parserFiles],
  },
};

export default nextConfig;
