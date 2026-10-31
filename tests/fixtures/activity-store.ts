import type { DataClient } from '@/db/models';
import type { TablesUpdate } from '@/db/database.types';
import type { ActivityJob } from '@/modules/workflow/activity';
import { createKnowledgeSources } from '@/db/knowledge-sources';
import { createKnowledgeDocuments } from '@/db/knowledge-documents';
export async function seedActivityJob(
  client: DataClient,
  owner: { id: string; accountId: string },
  options: {
    status?: ActivityJob['status'];
    createdAt?: string;
    reason?: string;
    threadId?: string;
  } = {},
) {
  const id = crypto.randomUUID(),
    threadId = options.threadId ?? `thread54_${id.replaceAll('-', '')}`,
    targetMessageId = `message54_${id.replaceAll('-', '')}`,
    stamp = new Date().toISOString();
  const base = {
    id,
    user_id: owner.id,
    gmail_account_id: owner.accountId,
    thread_id: threadId,
    target_message_id: targetMessageId,
    ...(options.createdAt ? { created_at: options.createdAt } : {}),
  };
  const result = await client.from('email_jobs').insert(base);
  if (result.error) throw result.error;
  const status = options.status ?? 'PENDING';
  const update = async (values: TablesUpdate<'email_jobs'>) => {
    const result = await client.from('email_jobs').update(values).eq('id', id);
    if (result.error) throw result.error;
  };
  if (status !== 'PENDING') {
    await update({
      status: 'CLASSIFYING',
      started_at: stamp,
      classification_started_at: stamp,
      attempt_count: 1,
      lease_id: crypto.randomUUID(),
      lease_expires_at: new Date(Date.now() + 300000).toISOString(),
    });
    if (status !== 'CLASSIFYING') {
      const classification = {
        decision:
          status === 'SKIPPED'
            ? 'NO_REPLY'
            : status === 'REVIEW_REQUIRED'
              ? 'UNCERTAIN'
              : 'REPLY_REQUIRED',
        intent: 'REQUEST_INFORMATION',
        reasons: [
          options.reason ??
            (status === 'SKIPPED'
              ? 'EXCLUDED_DOMAIN'
              : status === 'FAILED'
                ? 'MODEL_UNAVAILABLE'
                : 'EXPLICIT_QUESTION'),
        ],
        riskFlags: [],
        needsAttachment: false,
        source: 'RULE',
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      await update({
        status: status === 'DRAFT_CREATED' ? 'GENERATING' : status,
        classification,
        classification_finished_at: stamp,
        reason_code:
          options.reason ??
          (status === 'SKIPPED'
            ? 'EXCLUDED_DOMAIN'
            : status === 'FAILED'
              ? 'MODEL_UNAVAILABLE'
              : status === 'REVIEW_REQUIRED'
                ? 'INSUFFICIENT_CONTEXT'
                : null),
        lease_id: null,
        lease_expires_at: null,
        finished_at: ['SKIPPED', 'REVIEW_REQUIRED', 'FAILED'].includes(status)
          ? stamp
          : null,
      });
      if (status === 'DRAFT_CREATED')
        await update({
          status,
          reason_code: null,
          draft_id: `draft54_${id.replaceAll('-', '')}`,
          generation_started_at: stamp,
          generation_finished_at: stamp,
          finished_at: stamp,
        });
    }
  }
  return { ...base, threadId, targetMessageId };
}
export async function seedActivitySource(
  client: DataClient,
  owner: { id: string; accountId: string },
  job: { id: string; threadId: string; targetMessageId: string },
) {
  const sources = createKnowledgeSources(client, owner.id),
    documents = createKnowledgeDocuments(client, owner.id);
  const source = await sources.mutate({
    action: 'save_source',
    title: 'Manual MAIL-054',
    priority: 0,
    enabled: true,
  });
  const document = await documents.upload(
    new File(
      [
        'Contenido privado de prueba MAIL054_BODY_SENTINEL. El horario de atención es de 09:00 a 17:00.',
      ],
      'manual-mail054.txt',
      { type: 'text/plain' },
    ),
  );
  await sources.mutate({
    action: 'assign_document',
    documentId: document.id,
    sourceId: source.id,
  });
  const chunks = await client
    .from('knowledge_chunks')
    .select('id')
    .eq('user_id', owner.id)
    .eq('document_id', document.id)
    .limit(1)
    .single();
  if (chunks.error) throw chunks.error;
  const attempt = await client
    .from('draft_generations')
    .insert({
      id: crypto.randomUUID(),
      user_id: owner.id,
      gmail_account_id: owner.accountId,
      email_job_id: job.id,
      thread_id: job.threadId,
      target_message_id: job.targetMessageId,
      style_revision: crypto.randomUUID(),
      model: 'test-model',
      prompt_version: 'mail049-v1',
      input_tokens: 10,
      output_tokens: 10,
      status: 'CREATED',
      draft_id: `draft54_${job.id.replaceAll('-', '')}`,
      draft_message_id: 'draft_message54',
      verified_at: new Date().toISOString(),
      warnings: ['HUMAN_REVIEW_REQUIRED'],
      sources_used: [
        { kind: 'THREAD_MESSAGE', messageIndex: 0 },
        { kind: 'HISTORICAL_MESSAGE', referenceId: 'OTHER_PRIVATE_MESSAGE_ID' },
        {
          kind: 'KNOWLEDGE_FRAGMENT',
          sourceId: source.id,
          documentId: document.id,
          version: document.version,
          chunkId: chunks.data.id,
        },
      ],
    })
    .select('id')
    .single();
  if (attempt.error) throw attempt.error;
  return { source, document, attempt: attempt.data };
}
