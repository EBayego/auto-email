import {
  test,
  expect,
  login,
  service,
  createStylePreferenceRepository,
} from './world';
import { scenarios } from './scenarios';
import { jobLabels } from '@/modules/workflow/activity';
import { readFile } from 'node:fs/promises';

test('MAIL-068 — portada y privacidad accesibles sin sesión antes de conectar Gmail', async ({
  page,
}) => {
  const readiness = await page.request.get('/api/health/ready');
  expect(readiness.status()).toBe(200);
  expect(await readiness.json()).toEqual({ status: 'ok' });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Auto Email', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Acceso en pruebas');
  await expect(
    page.getByText('pendiente de la verificación de Google', { exact: false }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Privacidad y condiciones', exact: true })
    .click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(
    page.getByRole('heading', { name: 'Privacidad y condiciones de uso' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', {
      name: 'Google API Services User Data Policy (Limited Use)',
    }),
  ).toBeVisible();
  await expect(
    page.getByText('gmail.compose permite técnicamente enviar', {
      exact: false,
    }),
  ).toBeVisible();
});

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`MAIL-071 — oferta y demo sin envío en ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET') writes.push(request.url());
    });
    await page.goto('/');
    await expect(
      page.getByText('Contratación y cobro todavía no disponibles.', {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByText('49 €', { exact: false }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('Sin renovación automática.', { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Anterior', exact: true }),
    ).toBeDisabled();
    await page
      .getByRole('button', { name: 'Ver el contexto', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Ficha de Atlas · ejemplo ficticio' }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Ver el resultado', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Una respuesta que puedes revisar.' }),
    ).toBeVisible();
    await expect(
      page.getByText('Atlas cuesta 125 euros.', { exact: false }),
    ).toBeVisible();
    await page.getByLabel('Probar qué ocurre si falta la tarifa').check();
    await expect(
      page.getByRole('heading', { name: 'Consulta sobre el servicio Atlas' }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Ver el contexto', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Falta una tarifa vigente' }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Ver el resultado', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Se detiene la propuesta.' }),
    ).toBeVisible();
    await expect(
      page.getByText('no se crea ningún borrador', { exact: false }),
    ).toBeVisible();
    expect(
      await page
        .locator('body')
        .evaluate((body) => body.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(writes).toEqual([]);
    await page
      .getByRole('button', { name: 'Repetir demostración', exact: true })
      .click();
    await page.getByLabel('Probar qué ocurre si falta la tarifa').uncheck();
    await page.screenshot({
      path: `coverage/e2e/landing-${viewport.width}.png`,
      fullPage: true,
    });
  });
}

test.describe('MAIL-065 regresión funcional antes de desplegar', () => {
  for (const scenario of scenarios) {
    test(`${scenario.id} — ${scenario.title}`, async ({
      world,
      page,
      browser,
    }) => {
      const actor = await world.create(scenario);
      await login(page, actor);
      await page
        .getByRole('navigation', { name: 'Navegación principal' })
        .getByRole('link', { name: 'Ajustes' })
        .click();
      await expect(
        page.getByRole('heading', { name: 'Automatización y límites' }),
      ).toBeVisible();
      await page.getByLabel('Activar automatización', { exact: true }).check();
      await page
        .getByRole('button', { name: 'Guardar configuración', exact: true })
        .click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Configuración guardada' }),
      ).toBeVisible();
      const manualBefore = actor.manual ? structuredClone(actor.manual) : null;
      if (scenario.id === 'disconnected') await world.disconnect(actor);
      await world.cycle(actor);
      const job = await world.job(actor);
      expect(
        job?.status ?? null,
        JSON.stringify({
          reason: job?.reason_code,
          events: world.events,
          phases: actor.modelCalls.map((c) => c.schema),
        }),
      ).toBe(scenario.status);
      expect(actor.writes).toBe(scenario.drafts);
      expect(actor.drafts).toHaveLength(scenario.drafts);
      await page
        .getByRole('navigation', { name: 'Navegación principal' })
        .getByRole('link', { name: 'Actividad' })
        .click();
      if (job) {
        const item = page.getByRole('listitem').filter({
          has: page.getByRole('heading', {
            name: `Mensaje ${job.id.slice(0, 8)}`,
          }),
        });
        await expect(
          item.getByText(jobLabels[job.status as keyof typeof jobLabels], {
            exact: true,
          }),
        ).toBeVisible();
        await item
          .getByRole('link', {
            name: `Ver detalle del mensaje ${job.id.slice(0, 8)}`,
          })
          .click();
        await expect(page).toHaveURL(new RegExp(`/activity/${job.id}`));
        if (job.status === 'REVIEW_REQUIRED') {
          expect(job.reason_code).toBeTruthy();
          await expect(
            page.getByText('Requiere revisión', { exact: true }).first(),
          ).toBeVisible();
        }
      } else {
        await expect(
          page.getByText('No hay mensajes para mostrar', { exact: false }),
        ).toBeVisible();
        expect(actor.reads).toBe(0);
      }
      if (
        scenario.id === 'newsletter' ||
        scenario.id === 'no-reply' ||
        scenario.id === 'answered' ||
        scenario.id === 'manual-draft'
      )
        expect(actor.modelCalls).toHaveLength(0);
      if (scenario.id === 'manual-draft')
        expect(actor.manual).toEqual(manualBefore);
      if (scenario.id === 'twice') {
        const calls = actor.modelCalls.length;
        // Make another scheduled scan eligible and redetect the same Gmail ID.
        expect(
          (
            await service
              .from('gmail_accounts')
              .update({ next_sync_at: '2000-01-01T00:00:00Z' })
              .eq('id', actor.accountId)
          ).error,
        ).toBeNull();
        await world.cycle(actor);
        expect(actor.writes).toBe(1);
        expect(actor.modelCalls).toHaveLength(calls);
        expect(
          world.events.filter((event) => event.type === 'SYNC_COMPLETED'),
        ).toHaveLength(2);
        expect(
          (
            await service
              .from('draft_generations')
              .select('id')
              .eq('user_id', actor.id)
          ).data,
        ).toHaveLength(1);
      }
      if (scenario.id === 'authority') {
        const draft = await world.draftText(actor);
        expect(draft).toContain('125 euros');
        expect(draft).not.toContain('90 euros');
        const generation = actor.modelCalls.find(
          (c) => c.schema === 'generated_response_v1',
        );
        expect(
          generation?.payload.knowledge?.some((k) =>
            k.content.includes('125 euros'),
          ),
        ).toBe(true);
        const run = await service
          .from('generation_runs')
          .select('sources_used,configuration')
          .eq('user_id', actor.id)
          .single();
        expect(run.error).toBeNull();
        expect(JSON.stringify(run.data?.sources_used)).toContain(
          'KNOWLEDGE_FRAGMENT',
        );
      }
      if (scenario.id === 'expired')
        expect(
          actor.modelCalls.filter((c) => c.schema === 'generated_response_v1'),
        ).toHaveLength(0);
      if (scenario.id === 'google-retry')
        expect(actor.transientFailures).toBe(1);
      if (scenario.id === 'late-reply') {
        expect(
          actor.modelCalls.some((c) => c.schema === 'generated_response_v1'),
        ).toBe(true);
        const attempts = await service
          .from('draft_generations')
          .select('status,write_started_at')
          .eq('user_id', actor.id);
        expect(attempts.error).toBeNull();
        expect(
          attempts.data?.every(
            (a) => a.status === 'CANCELLED' && !a.write_started_at,
          ),
        ).toBe(true);
      }
      if (scenario.id === 'english') {
        expect(await world.draftText(actor)).toContain('I confirm');
        expect(
          actor.modelCalls.find((c) => c.schema === 'generated_response_v1')
            ?.payload.replyTask?.targetLanguage,
        ).toBe('en');
      }
      if (scenario.id === 'isolation') {
        await world.enable(actor, false);
        const other = await world.create(scenario, {
          threadId: actor.thread.id,
          messageId: actor.incoming.id,
        });
        await world.enable(other);
        await world.cycle(other);
        const otherJob = await world.job(other);
        expect(otherJob?.status).toBe('DRAFT_CREATED');
        const context = await browser.newContext();
        try {
          await context.route('**/*', (route) =>
            new URL(route.request().url()).origin ===
            process.env.AUTO_EMAIL_TEST_APP_URL
              ? route.continue()
              : route.abort(),
          );
          const otherPage = await context.newPage();
          await otherPage.goto(`${process.env.AUTO_EMAIL_TEST_APP_URL}/login`);
          await otherPage
            .getByLabel('Correo electrónico', { exact: true })
            .fill(other.email);
          await otherPage
            .getByLabel('Contraseña', { exact: true })
            .fill(other.password);
          await otherPage
            .getByRole('button', { name: 'Iniciar sesión', exact: true })
            .click();
          await expect(otherPage).toHaveURL(/\/dashboard$/);
          await otherPage.goto(
            `${process.env.AUTO_EMAIL_TEST_APP_URL}/activity`,
          );
          await expect(
            otherPage.getByRole('heading', {
              name: `Mensaje ${otherJob!.id.slice(0, 8)}`,
            }),
          ).toBeVisible();
          await expect(
            otherPage.getByRole('heading', {
              name: `Mensaje ${job!.id.slice(0, 8)}`,
            }),
          ).toHaveCount(0);
          expect(
            (await otherPage.request.get(`/api/activity/${job!.id}`)).status(),
          ).toBe(404);
          expect(
            (await page.request.get(`/api/activity/${otherJob!.id}`)).status(),
          ).toBe(404);
          expect(actor.writes).toBe(1);
          expect(other.writes).toBe(1);
        } finally {
          await context.close();
        }
      }
    });
  }
  test('la configuración explícita de idioma prevalece sobre el correo recibido', async ({
    world,
    page,
  }) => {
    const actor = await world.create(
      scenarios.find((s) => s.id === 'english')!,
    );
    await createStylePreferenceRepository(
      service,
      actor.id,
      actor.accountId,
    ).set({
      scope: { kind: 'GENERAL', key: '' },
      preference: { key: 'language', value: 'es' },
    });
    await world.enable(actor);
    await login(page, actor);
    await world.cycle(actor);
    expect((await world.job(actor))?.status).toBe('DRAFT_CREATED');
    expect(await world.draftText(actor)).toContain('Confirmo que he recibido');
    expect(
      actor.modelCalls.find((c) => c.schema === 'generated_response_v1')
        ?.payload.replyTask?.targetLanguage,
    ).toBe('es');
  });
  test('carga, descarga y elimina un documento desde los controles de la interfaz', async ({
    world,
    page,
  }) => {
    const actor = await world.create(scenarios[0]);
    await login(page, actor);
    await page
      .getByRole('navigation', { name: 'Navegación principal' })
      .getByRole('link', { name: 'Conocimiento' })
      .click();
    await page
      .getByLabel('Seleccionar documento', { exact: true })
      .setInputFiles({
        name: 'manual-e2e.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(
          'Procedimiento privado: consultar al equipo autorizado.',
        ),
      });
    await page
      .getByRole('button', { name: 'Subir documento', exact: true })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Documento incorporado.' }),
    ).toBeVisible();
    const item = page
      .getByRole('listitem')
      .filter({ hasText: 'manual-e2e.txt' });
    await expect(item).toContainText('Texto extraído');
    const downloadEvent = page.waitForEvent('download');
    await item.getByRole('link', { name: 'Descargar', exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe('manual-e2e.txt');
    expect(await readFile(await download.path(), 'utf8')).toBe(
      'Procedimiento privado: consultar al equipo autorizado.',
    );
    await item
      .getByRole('button', { name: 'Eliminar documento', exact: true })
      .click();
    await item
      .getByRole('button', { name: 'Sí, eliminar documento', exact: true })
      .click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Documento y texto extraído eliminados.' }),
    ).toBeVisible();
    await expect(page.getByText('manual-e2e.txt', { exact: true })).toHaveCount(
      0,
    );
    expect(
      (
        await service
          .from('source_documents')
          .select('id')
          .eq('user_id', actor.id)
      ).data,
    ).toEqual([]);
  });
  test('sin sesión no se accede al espacio privado y una contraseña incorrecta no inicia sesión', async ({
    world,
    page,
  }) => {
    const actor = await world.create(scenarios[0]);
    await page.goto('/activity');
    await expect(page).toHaveURL(/\/login$/);
    await page
      .getByLabel('Correo electrónico', { exact: true })
      .fill(actor.email);
    await page
      .getByLabel('Contraseña', { exact: true })
      .fill('Contraseña-incorrecta-065');
    await page
      .getByRole('button', { name: 'Iniciar sesión', exact: true })
      .click();
    await expect(page.getByRole('alert')).toBeVisible();
    expect((await page.request.get('/api/account')).status()).toBe(401);
  });
});
