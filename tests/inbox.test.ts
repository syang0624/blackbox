import { describe, it, expect } from 'vitest';
import { MOCK_INBOX } from '../src/demo/inbox.js';

describe('mock inbox', () => {
  it('has ~15 emails with unique ids', () => {
    expect(MOCK_INBOX.length).toBeGreaterThanOrEqual(12);
    expect(new Set(MOCK_INBOX.map((e) => e.id)).size).toBe(MOCK_INBOX.length);
  });
  it('contains the load-bearing Asiana signal emails', () => {
    const bodies = MOCK_INBOX.map((e) => `${e.subject} ${e.body}`).join(' ');
    expect(bodies).toContain('OZ212');
    expect(bodies).toContain('XKRF2M');
    expect(bodies).toContain('920384712');
    expect(bodies).toContain('1087');
    expect(bodies).toContain('0988-7234');
  });
  it('includes decoys (unrelated bookings) to force discrimination', () => {
    expect(MOCK_INBOX.some((e) => /delta|hotel|promo|amazon|united/i.test(`${e.subject} ${e.from}`))).toBe(true);
  });
});
