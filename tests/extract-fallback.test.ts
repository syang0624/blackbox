import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/extraction/rocketride.js', () => ({
  rocketrideConfigured: () => false,
  extractWithRocketRide: vi.fn(),
}));
vi.mock('../src/ai/extract.js', () => ({
  extractWithButterbase: vi.fn(async () => ({ booking: { pnr: 'XKRF2M' } })),
}));

import { extractEmailEntities } from '../src/extraction/index.js';
import { extractWithButterbase } from '../src/ai/extract.js';

describe('extractEmailEntities', () => {
  it('uses Butterbase when RocketRide is not configured', async () => {
    const out = await extractEmailEntities({ id: 'x', from: '', to: '', subject: '', date: '', body: '' });
    expect(out.booking?.pnr).toBe('XKRF2M');
    expect(extractWithButterbase).toHaveBeenCalledOnce();
  });
});
