import { describe, it, expect, afterAll } from 'vitest';
import { config } from '../src/config.js';
import { startExtractionPipeline, extractWithRocketRide, stopExtractionPipeline } from '../src/extraction/rocketride.js';

const run = config.rocketride.configured ? describe : describe.skip;
afterAll(async () => {
  await stopExtractionPipeline();
});

run('rocketride extraction (live)', () => {
  it('extracts booking + flight from the Asiana confirmation', async () => {
    await startExtractionPipeline();
    const out = await extractWithRocketRide({
      id: 'em-asiana-conf',
      from: 'no-reply@flyasiana.com',
      to: 'steven@example.com',
      subject: 'Your Asiana booking is confirmed - XKRF2M',
      date: '2026-06-15T09:00:00Z',
      body: 'Confirmation XKRF2M. Flight OZ212 from Seoul Incheon (ICN) to San Francisco (SFO) on July 3, 2026. Passenger: Steven Yang.',
    });
    expect(out.booking?.pnr).toBe('XKRF2M');
    expect(out.flight?.number).toBe('OZ212');
  });
});
