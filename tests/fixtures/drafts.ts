import { vi } from 'vitest';
import type {
  GmailClient,
  GmailMessage,
  GmailThread,
  TextGenerationClient,
} from '@/providers/contracts';
import type { DraftRecord, DraftStore } from '@/modules/gmail/draft-contracts';
import { createEmailFixtures } from './emails';
import { readyResponse, supportedResponse } from './responses';
import {
  profileWork,
  writingProfileFixture,
  writingProfileRow,
} from './writing-profile';

export function memoryDraftStore() {
  const rows: DraftRecord[] = [];
  const writing = new Set<string>();
  const store = {
    find: vi.fn<DraftStore['find']>(
      async (target) =>
        rows.find((row) => row.targetMessageId === target) ?? null,
    ),
    reserve: vi.fn<DraftStore['reserve']>(async (input) => {
      const existing = rows.find(
        (row) =>
          row.targetMessageId === input.targetMessageId ||
          (row.threadId === input.threadId &&
            ['CREATING', 'UNCERTAIN'].includes(row.status)),
      );
      if (existing) return { acquired: false, record: { ...existing } };
      const record: DraftRecord = {
        id: input.id,
        threadId: input.threadId,
        targetMessageId: input.targetMessageId,
        status: 'CREATING',
        draftId: null,
        draftMessageId: null,
        verified: false,
      };
      rows.push(record);
      return { acquired: true, record: { ...record } };
    }),
    beginWrite: vi.fn<DraftStore['beginWrite']>(
      async (id, threadId, targetMessageId) => {
        const row = rows.find(
          (row) =>
            row.id === id &&
            row.threadId === threadId &&
            row.targetMessageId === targetMessageId &&
            row.status === 'CREATING',
        );
        if (!row || writing.has(id)) return false;
        writing.add(id);
        return true;
      },
    ),
    created: vi.fn<DraftStore['created']>(async (id, draftId, messageId) => {
      Object.assign(
        rows.find((row) => row.id === id)!,
        { status: 'CREATED', draftId, draftMessageId: messageId },
      );
    }),
    verified: vi.fn<DraftStore['verified']>(async (id) => {
      rows.find((row) => row.id === id)!.verified = true;
    }),
    stop: vi.fn<DraftStore['stop']>(
      async (id, status, _reason, identifiers) => {
        Object.assign(
          rows.find((row) => row.id === id)!,
          { status, ...identifiers },
        );
      },
    ),
  };
  return { store, rows };
}
export function draftFixture() {
  const thread: GmailThread = createEmailFixtures(
    'Hola, por favor confirma que has recibido este correo. Gracias.',
  ).pending;
  let saved: GmailMessage | null = null;
  const gmail = {
    listMessages: vi
      .fn<GmailClient['listMessages']>()
      .mockResolvedValue({ messages: [] }),
    getThread: vi.fn<GmailClient['getThread']>().mockResolvedValue(thread),
    getMessage: vi.fn<GmailClient['getMessage']>(async () => {
      if (!saved) throw new Error('No draft created');
      return saved;
    }),
    createDraft: vi.fn<GmailClient['createDraft']>(async (message, guard) => {
      await guard?.prepare();
      await guard?.beforeRequest();
      saved = {
        id: 'draft-message-21',
        threadId: message.threadId!,
        labelIds: ['DRAFT'],
        raw: message.raw,
      };
      return {
        id: 'r-draft-21',
        message: {
          id: saved.id,
          threadId: saved.threadId,
          labelIds: saved.labelIds,
        },
      };
    }),
  };
  const text = {
    generate: vi.fn<TextGenerationClient['generate']>(async (input) => ({
      text: JSON.stringify(
        input.jsonSchema?.name === 'response_verification_v1'
          ? supportedResponse()
          : readyResponse(),
      ),
      inputTokens: 100,
      outputTokens: 30,
    })),
  };
  const memory = memoryDraftStore();
  return {
    gmail,
    text,
    ...memory,
    model: 'test-model',
    thread,
    selection: {
      accountId: profileWork.gmailAccountId,
      mailboxAddress: 'owner@example.invalid',
      threadId: thread.id,
      style: {
        revision: writingProfileRow().revision,
        profile: writingProfileFixture(),
      },
    },
  };
}
