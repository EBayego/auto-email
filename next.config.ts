import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Las instrucciones propias del repositorio se incorporarán en MAIL-010.
  agentRules: false,
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
