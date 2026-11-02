import net from 'node:net';
import {
  testNetworkOrigins,
  testFetch,
  testSocketAllowed,
  blockedTestNetwork,
} from './network-policy.mjs';

// Preload in Vitest workers and the Next server, before an SDK can retain fetch.
const origins = testNetworkOrigins(process.env);
globalThis.fetch = testFetch(origins, globalThis.fetch);
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  if (!testSocketAllowed(origins, args)) throw blockedTestNetwork();
  return Reflect.apply(connect, this, args);
};
