import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  privacyNoticeVersion,
  privacySections,
  privacyGrantText,
  PrivacyError,
} from './notice';

const identitySchema = z.object({
  operator: z.string().trim().min(2).max(200),
  email: z.email().max(254),
  address: z.string().trim().min(5).max(500),
  hosting: z.string().trim().min(2).max(500),
  processing: z.string().trim().min(20).max(6000),
});
export function readPrivacyNotice(
  env: Record<string, string | undefined> = process.env,
) {
  const parsed = identitySchema.safeParse({
    operator: env.PRIVACY_OPERATOR_NAME,
    email: env.PRIVACY_CONTACT_EMAIL,
    address: env.PRIVACY_OPERATOR_ADDRESS,
    hosting: env.PRIVACY_HOSTING_PROVIDER,
    processing: env.PRIVACY_PROCESSING_DISCLOSURE,
  });
  const identity = parsed.success ? parsed.data : null;
  const ready = !!identity && env.PRIVACY_REVIEW_APPROVED === 'true';
  const snapshot = JSON.stringify({
    version: privacyNoticeVersion,
    sections: privacySections,
    authorization: privacyGrantText,
    identity,
  });
  return {
    version: privacyNoticeVersion,
    sections: privacySections,
    identity,
    ready,
    snapshot,
    hash: createHash('sha256').update(snapshot).digest('hex'),
  };
}
export function requirePrivacyNotice(env?: Record<string, string | undefined>) {
  const notice = readPrivacyNotice(env);
  if (!notice.ready) throw new PrivacyError('PRIVACY_CONFIGURATION_REQUIRED');
  return notice;
}
