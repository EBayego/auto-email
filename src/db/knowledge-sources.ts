import type { DataClient } from './models';
import { DataAccessError, requireUuid } from './errors';
import {
  sourceContextSchema,
  sourceOperationSchema,
  SourceConfigurationError,
  type SourceConfiguration,
  type SourceOperation,
} from '@/modules/source-router/sources';
import {
  routeSources,
  searchWithSourcePlan,
} from '@/modules/source-router/route-sources';
import {
  createKnowledgeRetriever,
  knowledgeFragmentSchema,
} from '@/modules/knowledge/retriever';

function databaseError(error: { code?: string; message: string }): never {
  if (
    ['SOURCE_LIMIT', 'RULE_LIMIT', 'SOURCE_CONFIGURATION_CHANGED'].includes(
      error.message,
    )
  )
    throw new SourceConfigurationError(
      error.message as
        'SOURCE_LIMIT' | 'RULE_LIMIT' | 'SOURCE_CONFIGURATION_CHANGED',
    );
  if (error.code === '23503')
    throw new SourceConfigurationError('SOURCE_IN_USE');
  if (
    error.code === '23505' ||
    error.code === '23514' ||
    error.message === 'INVALID_SOURCE_RULE'
  )
    throw new DataAccessError('INVALID_INPUT');
  if (error.message === 'SOURCE_NOT_FOUND')
    throw new DataAccessError('NOT_FOUND');
  if (error.message === 'SOURCE_OWNER_UNAVAILABLE')
    throw new DataAccessError('FORBIDDEN');
  throw new DataAccessError('UNAVAILABLE');
}

export function createKnowledgeSources(client: DataClient, userId: string) {
  requireUuid(userId);
  async function list(): Promise<SourceConfiguration> {
    const result = await client.rpc('get_knowledge_source_configuration', {
      p_user_id: userId,
    });
    if (result.error) databaseError(result.error);
    if (!result.data) throw new DataAccessError('FORBIDDEN');
    return result.data as unknown as SourceConfiguration;
  }
  const retriever = createKnowledgeRetriever({
    configuration: list,
    async search({ query, sourceIds, revision, limit, recipient }) {
      // Each source gets a bounded candidate pool; an authoritative source
      // with many hits cannot crowd all other sources out of the retrieval.
      const results = await Promise.allSettled(
        sourceIds.map((id) =>
          client.rpc('search_knowledge_context_chunks', {
            p_user_id: userId,
            p_query: query,
            p_source_ids: [id],
            p_revision: revision,
            p_limit: limit,
            p_recipient: recipient ?? '',
          }),
        ),
      );
      return results.flatMap((result) => {
        if (result.status === 'rejected')
          throw new DataAccessError('UNAVAILABLE');
        if (result.value.error) databaseError(result.value.error);
        return (result.value.data ?? []).map(({ rank, ...fields }) => {
          const parsed = knowledgeFragmentSchema.safeParse({
            ...fields,
            source_priority: 0,
          });
          if (!parsed.success) throw new DataAccessError('UNAVAILABLE');
          const { source_priority: _priority, ...fragment } = parsed.data;
          void _priority;
          return { ...fragment, rank };
        });
      });
    },
    async assertRevision(revision) {
      if ((await list()).revision !== revision)
        throw new SourceConfigurationError('SOURCE_CONFIGURATION_CHANGED');
    },
  });
  return Object.freeze({
    list,
    retrieve: retriever.retrieve,
    async mutate(input: SourceOperation) {
      const parsed = sourceOperationSchema.safeParse(input);
      if (!parsed.success) throw new DataAccessError('INVALID_INPUT');
      const operation = parsed.data;
      if (operation.action === 'set_sufficiency_preferences') {
        const result = await client.rpc(
          'set_knowledge_sufficiency_preferences',
          {
            p_user_id: userId,
            p_allow_partial_drafts: operation.allowPartialDrafts,
          },
        );
        if (result.error) databaseError(result.error);
        if (!result.data) throw new DataAccessError('FORBIDDEN');
        return { id: userId };
      }
      if (operation.action === 'save_source') {
        const result = await client.rpc('save_knowledge_source', {
          p_user_id: userId,
          p_source_id: operation.id,
          p_title: operation.title,
          p_priority: operation.priority,
          p_enabled: operation.enabled,
        });
        if (result.error) databaseError(result.error);
        return { id: result.data!.id };
      }
      if (operation.action === 'save_rule') {
        const result = await client.rpc('save_source_rule', {
          p_user_id: userId,
          p_rule_id: operation.id,
          p_title: operation.title,
          p_intent: operation.intent,
          p_terms: operation.terms,
          p_priority: operation.priority,
          p_enabled: operation.enabled,
          p_allow_email_history: operation.allowEmailHistory,
          p_primary_ids: operation.primarySourceIds,
          p_fallback_ids: operation.fallbackSourceIds,
          p_excluded_ids: operation.excludedSourceIds,
        });
        if (result.error) databaseError(result.error);
        return { id: result.data!.id };
      }
      if (operation.action === 'assign_document') {
        const result = await client.rpc('assign_document_source', {
          p_user_id: userId,
          p_document_id: operation.documentId,
          p_source_id: operation.sourceId ?? undefined,
        });
        if (result.error) databaseError(result.error);
        if (!result.data) throw new DataAccessError('NOT_FOUND');
        return { id: operation.documentId };
      }
      const result = await client.rpc('delete_knowledge_source_item', {
        p_user_id: userId,
        p_kind: operation.action === 'delete_source' ? 'source' : 'rule',
        p_id: operation.id,
      });
      if (result.error) databaseError(result.error);
      if (!result.data) throw new DataAccessError('NOT_FOUND');
      return { id: operation.id };
    },
    async plan(input: unknown) {
      const context = sourceContextSchema.safeParse(input);
      if (!context.success) throw new DataAccessError('INVALID_INPUT');
      return routeSources(await list(), context.data);
    },
    async search(input: unknown, limit = 10) {
      const context = sourceContextSchema.safeParse(input);
      if (
        !context.success ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 20
      )
        throw new DataAccessError('INVALID_INPUT');
      const configuration = await list();
      const plan = routeSources(configuration, context.data);
      const results = await searchWithSourcePlan(plan, async (ids) => {
        const result = await client.rpc('search_knowledge_source_chunks', {
          p_user_id: userId,
          p_query: context.data.query,
          p_source_ids: ids,
          p_revision: configuration.revision,
          p_limit: limit,
        });
        if (result.error) databaseError(result.error);
        return result.data ?? [];
      });
      return { plan, ...results };
    },
  });
}
