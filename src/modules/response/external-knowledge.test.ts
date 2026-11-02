import { describe, it, expect, vi } from 'vitest';
import { createResponseGenerator } from './generator';
import {
  responseInput,
  readyResponse,
  supportedResponse,
} from '../../../tests/fixtures/responses';
import {
  knowledgeFragment,
  knowledgeId,
} from '../../../tests/fixtures/knowledge';
function fixture() {
  const input = {
    ...responseInput(),
    knowledge: [
      knowledgeFragment({
        connector_id: knowledgeId(99),
        origin_url: 'https://tenant.sharepoint.com/sites/test/doc',
      }),
    ],
  };
  const client = {
    generate: vi
      .fn()
      .mockResolvedValueOnce({
        text: JSON.stringify(readyResponse()),
        inputTokens: 20,
        outputTokens: 20,
      })
      .mockResolvedValueOnce({
        text: JSON.stringify(supportedResponse()),
        inputTokens: 20,
        outputTokens: 20,
      }),
  };
  return { input, client };
}
describe('revalidación de información externa al llamar al modelo', () => {
  it('comprueba cada llamada, incluida la verificación independiente', async () => {
    const { input, client } = fixture();
    const assertKnowledge = vi.fn().mockResolvedValue(undefined);
    await createResponseGenerator(client, { assertKnowledge }).generate(input);
    expect(assertKnowledge).toHaveBeenCalledTimes(2);
    expect(client.generate).toHaveBeenCalledTimes(2);
  });
  it('no transmite los fragmentos si el acceso cambia antes de la segunda llamada', async () => {
    const { input, client } = fixture();
    const assertKnowledge = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('EVIDENCE_CHANGED'));
    await expect(
      createResponseGenerator(client, { assertKnowledge }).generate(input),
    ).rejects.toThrow('EVIDENCE_CHANGED');
    expect(client.generate).toHaveBeenCalledTimes(1);
  });
  it('requiere un comprobador para cualquier conocimiento externo', async () => {
    const { input, client } = fixture();
    await expect(
      createResponseGenerator(client).generate(input),
    ).rejects.toThrow('INVALID_INPUT');
    expect(client.generate).not.toHaveBeenCalled();
  });
});
