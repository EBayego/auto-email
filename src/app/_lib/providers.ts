import 'server-only';
import { cache } from 'react';
import { getWebServerConfig } from '@/config/env';
import { createGmailProviderClients } from '@/providers/runtime';

export const getProviders = cache(() =>
  createGmailProviderClients(getWebServerConfig()),
);
