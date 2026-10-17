import 'server-only';
import { cache } from 'react';
import { getServerConfig } from '@/config/env';
import { createProviderClients } from '@/providers/runtime';

export const getProviders = cache(() =>
  createProviderClients(getServerConfig()),
);
