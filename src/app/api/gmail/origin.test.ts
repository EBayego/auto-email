import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { gmailRequestOriginMatches } from './origin';

describe('Origen de los endpoints Gmail', () => {
  it('comprueba el host HTTP real aunque Next normalice la dirección de loopback', () => {
    const origin = 'http://127.0.0.1:3000';
    const request = new NextRequest(`${origin}/api/gmail/connect`, {
      headers: { host: '127.0.0.1:3000' },
    });
    expect(gmailRequestOriginMatches(request, origin)).toBe(true);
    expect(gmailRequestOriginMatches(request, 'http://127.0.0.1:3001')).toBe(
      false,
    );
  });
  it('rechaza hosts y protocolos distintos y no confía en forwarded-host', () => {
    expect(
      gmailRequestOriginMatches(
        new NextRequest('https://app.example.com/api/gmail/connect', {
          headers: {
            host: 'evil.invalid',
            'x-forwarded-host': 'app.example.com',
          },
        }),
        'https://app.example.com',
      ),
    ).toBe(false);
    expect(
      gmailRequestOriginMatches(
        new NextRequest('http://app.example.com/api/gmail/connect', {
          headers: { host: 'app.example.com' },
        }),
        'https://app.example.com',
      ),
    ).toBe(false);
  });
});
