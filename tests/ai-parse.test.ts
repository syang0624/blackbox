import { describe, it, expect } from 'vitest';
import { extractJsonBlock } from '../src/ai/gateway.js';

describe('extractJsonBlock', () => {
  it('strips ```json fences', () => {
    expect(JSON.parse(extractJsonBlock('```json\n{"a":1}\n```')).a).toBe(1);
  });
  it('returns bare json unchanged', () => {
    expect(JSON.parse(extractJsonBlock('{"b":2}')).b).toBe(2);
  });
  it('grabs the first object out of chatty text', () => {
    expect(JSON.parse(extractJsonBlock('Sure! {"c":3} hope that helps')).c).toBe(3);
  });
});
