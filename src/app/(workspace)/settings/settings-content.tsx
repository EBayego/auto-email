'use client';
import { useState } from 'react';
import type { AutomationSnapshot } from '@/modules/workflow/automation-settings';
import type { SourceConfiguration } from '@/modules/source-router/sources';
import { DocumentsPanel } from '@/app/app/documents-panel';
import { AutomationScreen } from './automation-screen';
export function SettingsContent({
  initial,
  sources,
  connected,
}: {
  initial: AutomationSnapshot | null;
  sources: SourceConfiguration | null;
  connected: boolean;
}) {
  const [configuration, setConfiguration] = useState(sources);
  return (
    <>
      {initial && (
        <AutomationScreen
          initial={initial}
          sources={configuration}
          connected={connected}
        />
      )}
      <div className="workspace-panel knowledge-panel">
        <DocumentsPanel onConfigurationChange={setConfiguration} />
      </div>
    </>
  );
}
