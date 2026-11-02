import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import nextEnvironment from '@next/env';
import { convert } from 'html-to-text';
import { z } from 'zod';
import project from '../google/project.json' with { type: 'json' };
import { readWebServerConfig } from '../src/config/env.ts';
import { gmailScopes } from '../src/config/google.ts';
import { readPrivacyNotice } from '../src/modules/privacy/config.ts';
import { checkGoogleCredentials } from './check-google.mjs';

const text = z.string().max(2000);
const list = z.array(text).max(20);
const publicationSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: text,
    appName: text,
    homepageUrl: text,
    privacyPolicyUrl: text,
    authorizedDomains: list,
    supportEmail: text,
    developerContactEmails: list,
    scopes: list,
    demoVideoUrl: text,
    evidence: z
      .object({
        domainOwnershipVerified: z.boolean(),
        brandingReviewed: z.boolean(),
        providerDataHandlingReviewed: z.boolean(),
        reviewerAccessTested: z.boolean(),
      })
      .strict(),
    review: z
      .object({
        status: z.enum([
          'not_submitted',
          'pending',
          'changes_requested',
          'approved',
        ]),
        caseReference: text,
        approvedScopes: list,
        approvalDate: text,
        securityAssessment: z
          .object({
            status: z.enum([
              'not_started',
              'pending',
              'passed',
              'exempted_by_google',
            ]),
            reference: text,
            validUntil: text,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

const sameScopes = (scopes) =>
  scopes.length === gmailScopes.length &&
  new Set(scopes).size === gmailScopes.length &&
  gmailScopes.every((scope) => scopes.includes(scope));
const substantive = (value) =>
  !!value.trim() &&
  !/^(?:pending|pendiente|todo|example|replace|<)/i.test(value);
function publicHost(host) {
  return (
    host.length <= 253 &&
    !isIP(host) &&
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) &&
    !/(?:^|\.)(?:localhost|invalid|test|example|local)$/.test(host) &&
    !/(?:^|\.)example\.(?:com|org|net)$/.test(host)
  );
}
function publicUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      publicHost(url.hostname) &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
      ? url
      : null;
  } catch {
    return null;
  }
}
const emailValid = (value) =>
  z.email().safeParse(value).success &&
  publicHost(value.split('@')[1]?.toLowerCase() ?? '');
function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === value
    ? time
    : NaN;
}

// Only explicit --check-public-pages performs anonymous GETs. No OAuth tokens or cookies.
async function publicHtml(url, fetcher) {
  const response = await fetcher(url.href, {
    method: 'GET',
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
    headers: { Accept: 'text/html' },
    signal: AbortSignal.timeout(10000),
  });
  if (
    response.status !== 200 ||
    !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') ?? '') ||
    !response.body
  )
    throw new Error('PUBLIC_PAGE_UNAVAILABLE');
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) throw new Error('PUBLIC_PAGE_TOO_LARGE');
      parts.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return convert(Buffer.concat(parts).toString('utf8'), {
    wordwrap: false,
    selectors: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((selector) => ({
      selector,
      options: { uppercase: false },
    })),
  });
}

export async function googlePublicationReadiness({
  publication,
  env,
  credentialsText,
  checkPublicPages = false,
  fetcher = fetch,
  now = Date.now(),
}) {
  const pending = new Set();
  const launchPending = new Set();
  let publicPagesChecked = false;
  let webConfig;
  try {
    webConfig = readWebServerConfig(env);
    if (
      webConfig.environment !== 'production' ||
      webConfig.providerMode !== 'live'
    )
      pending.add('PRODUCTION_WEB_CONFIGURATION');
  } catch {
    pending.add('PRODUCTION_WEB_CONFIGURATION');
  }
  if (!readPrivacyNotice(env).ready)
    pending.add('PRIVACY_CONFIGURATION_AND_REVIEW');
  const parsed = publicationSchema.safeParse(publication);
  const metadata = parsed.success ? parsed.data : null;
  if (!metadata) pending.add('PUBLICATION_MANIFEST');
  let client;
  try {
    if (!webConfig) throw new Error();
    checkGoogleCredentials(webConfig, credentialsText);
    client = JSON.parse(credentialsText).web;
  } catch {
    pending.add('GOOGLE_WEB_CLIENT');
  }
  const origin = publicUrl(env.APP_URL ?? '');
  if (!origin || origin.pathname !== '/') pending.add('PUBLIC_APP_ORIGIN');
  if (
    client &&
    origin &&
    (client.redirect_uris.length !== 1 ||
      client.redirect_uris[0] !== `${origin.origin}/api/gmail/callback` ||
      (client.javascript_origins !== undefined &&
        (!Array.isArray(client.javascript_origins) ||
          client.javascript_origins.some((value) => value !== origin.origin))))
  )
    pending.add('DEDICATED_PRODUCTION_CLIENT');
  if (metadata) {
    if (metadata.projectId !== project.projectId) pending.add('GOOGLE_PROJECT');
    if (metadata.appName !== 'Auto Email') pending.add('APP_BRANDING');
    const home = publicUrl(metadata.homepageUrl),
      privacy = publicUrl(metadata.privacyPolicyUrl);
    if (!origin || !home || home.href !== `${origin.origin}/`)
      pending.add('HOMEPAGE_URL');
    if (!origin || !privacy || privacy.href !== `${origin.origin}/privacy`)
      pending.add('PRIVACY_POLICY_URL');
    if (
      !metadata.authorizedDomains.length ||
      metadata.authorizedDomains.some(
        (domain) =>
          !publicHost(domain) ||
          !origin ||
          !(
            origin.hostname === domain || origin.hostname.endsWith(`.${domain}`)
          ),
      )
    )
      pending.add('AUTHORIZED_DOMAINS');
    if (!emailValid(metadata.supportEmail)) pending.add('SUPPORT_EMAIL');
    if (
      !metadata.developerContactEmails.length ||
      !metadata.developerContactEmails.every(emailValid)
    )
      pending.add('DEVELOPER_CONTACT_EMAILS');
    if (!sameScopes(metadata.scopes)) pending.add('EXACT_REQUESTED_SCOPES');
    const video = publicUrl(metadata.demoVideoUrl);
    if (
      !video ||
      !(
        (video.hostname === 'youtu.be' &&
          /^\/[A-Za-z0-9_-]{11}$/.test(video.pathname)) ||
        (video.hostname === 'www.youtube.com' &&
          /^\/embed\/[A-Za-z0-9_-]{11}$/.test(video.pathname))
      )
    ) {
      // Standard YouTube watch links carry a query; accept only a single video id.
      let watch;
      try {
        watch = new URL(metadata.demoVideoUrl);
      } catch {
        /* generic pending code below */
      }
      if (
        !watch ||
        watch.origin !== 'https://www.youtube.com' ||
        watch.username ||
        watch.password ||
        watch.pathname !== '/watch' ||
        watch.hash ||
        [...watch.searchParams.keys()].length !== 1 ||
        !/^[A-Za-z0-9_-]{11}$/.test(watch.searchParams.get('v') ?? '')
      )
        pending.add('DEMONSTRATION_VIDEO');
    }
    for (const [key, complete] of Object.entries(metadata.evidence))
      if (!complete)
        pending.add(
          `EVIDENCE_${key.replace(/[A-Z]/g, (v) => `_${v}`).toUpperCase()}`,
        );
    if (
      checkPublicPages &&
      origin &&
      home?.href === `${origin.origin}/` &&
      privacy?.href === `${origin.origin}/privacy`
    ) {
      publicPagesChecked = true;
      const [homeResult, privacyResult] = await Promise.allSettled([
        publicHtml(home, fetcher),
        publicHtml(privacy, fetcher),
      ]);
      if (homeResult.status === 'rejected') pending.add('PUBLIC_HOMEPAGE');
      else {
        if (!homeResult.value.includes(metadata.appName))
          pending.add('PUBLIC_APP_BRANDING');
        if (
          metadata.review.status === 'approved' &&
          homeResult.value.includes('pendiente de la verificación de Google')
        )
          launchPending.add('PUBLIC_TESTING_NOTICE');
        // html-to-text extracts real anchors and ignores scripts/styles/comments.
        if (
          !homeResult.value.includes(`[${privacy.href}]`) &&
          !homeResult.value.includes('[/privacy]')
        )
          pending.add('PUBLIC_PRIVACY_LINK');
      }
      if (privacyResult.status === 'rejected')
        pending.add('PUBLIC_PRIVACY_POLICY');
      else {
        const body = privacyResult.value;
        if (
          !['Auto Email', 'Google', 'OpenAI', 'Limited Use'].every((term) =>
            body.includes(term),
          )
        )
          pending.add('PUBLIC_PRIVACY_DISCLOSURES');
        if (
          /todavía no están definidos|Información pendiente de completar y revisar/.test(
            body,
          )
        )
          pending.add('PUBLIC_PRIVACY_UNFINISHED');
        const identity = readPrivacyNotice(env).identity;
        if (
          !identity ||
          ![identity.operator, identity.email].every((value) =>
            body.includes(value),
          )
        )
          pending.add('PUBLIC_OPERATOR_IDENTITY');
      }
    }
    const review = metadata.review;
    const approved = date(review.approvalDate);
    if (
      review.status !== 'approved' ||
      !substantive(review.caseReference) ||
      !sameScopes(review.approvedScopes) ||
      !Number.isFinite(approved) ||
      approved > now
    )
      launchPending.add('GOOGLE_APPROVAL_EVIDENCE');
    const assessment = review.securityAssessment;
    const until = date(assessment.validUntil);
    if (
      !['passed', 'exempted_by_google'].includes(assessment.status) ||
      !substantive(assessment.reference) ||
      !Number.isFinite(until) ||
      until + 86400000 <= now ||
      (assessment.status === 'passed' && until > now + 366 * 86400000)
    )
      launchPending.add('SECURITY_ASSESSMENT_EVIDENCE');
  } else {
    launchPending.add('GOOGLE_APPROVAL_EVIDENCE');
    launchPending.add('SECURITY_ASSESSMENT_EVIDENCE');
  }
  if (!publicPagesChecked) launchPending.add('PUBLIC_PAGES_NOT_CHECKED');
  return {
    projectId: project.projectId,
    submissionReady: pending.size === 0,
    publicLaunchEvidenceComplete:
      pending.size === 0 && launchPending.size === 0,
    remoteApprovalValidated: false,
    publicPagesChecked,
    pending: [...pending].sort(),
    launchPending: [...new Set([...pending, ...launchPending])].sort(),
  };
}

async function readJson(file) {
  const bytes = await readFile(file);
  if (bytes.byteLength > 65536) throw new Error('INPUT_TOO_LARGE');
  return JSON.parse(bytes.toString('utf8'));
}
export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      submission: { type: 'string' },
      credentials: { type: 'string' },
      'runtime-config': { type: 'string' },
      'check-public-pages': { type: 'boolean' },
      'require-approval': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'Uso: npm run google:release:check -- --submission /ruta/publication.json --credentials /ruta/client_secret.json [--runtime-config /ruta/web.json] [--check-public-pages] [--require-approval]\nComprobación local. Solo --check-public-pages consulta la portada y privacidad sin credenciales. No modifica Google Cloud, no envía la solicitud ni acredita una aprobación remota.',
    );
    return;
  }
  if (!values.submission || !values.credentials)
    throw new Error('INPUT_REQUIRED');
  let env;
  if (values['runtime-config']) {
    env = await readJson(values['runtime-config']);
    if (
      !env ||
      Array.isArray(env) ||
      typeof env !== 'object' ||
      Object.values(env).some((v) => typeof v !== 'string' || v.includes('\0'))
    )
      throw new Error('INVALID_RUNTIME_CONFIG');
  } else {
    nextEnvironment.loadEnvConfig(process.cwd(), false, {
      info() {},
      error() {},
    });
    env = process.env;
  }
  const credentials = await readJson(values.credentials);
  const report = await googlePublicationReadiness({
    publication: await readJson(values.submission),
    env,
    credentialsText: JSON.stringify(credentials),
    checkPublicPages: !!values['check-public-pages'],
  });
  console.log(
    JSON.stringify({ type: 'GOOGLE_PUBLICATION_READINESS', ...report }),
  );
  if (
    !report.submissionReady ||
    (values['require-approval'] && !report.publicLaunchEvidenceComplete)
  )
    process.exitCode = 1;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(() => {
    console.error(
      'GOOGLE_PUBLICATION_CHECK_FAILED: revisa los argumentos y los archivos JSON; no se han modificado datos.',
    );
    process.exitCode = 1;
  });
