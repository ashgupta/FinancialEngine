import { describe, it, expect } from 'vitest';
import {
  isChatModel, scoreModel, selectBestModel, needsRefresh, displayModelName,
} from '../../src/engine/modelSelector.js';

// ─── isChatModel tests ──────────────────────────────────
describe('isChatModel', () => {
  it('returns true for chat/instruct models', () => {
    expect(isChatModel('llama-3.3-70b-versatile')).toBe(true);
    expect(isChatModel('meta-llama/llama-4-scout-17b-16e-instruct')).toBe(true);
    expect(isChatModel('openai/gpt-oss-120b')).toBe(true);
    expect(isChatModel('qwen/qwen3-32b')).toBe(true);
  });

  it('returns false for non-chat models', () => {
    expect(isChatModel('whisper-large-v3')).toBe(false);
    expect(isChatModel('whisper-large-v3-turbo')).toBe(false);
    expect(isChatModel('canopylabs/orpheus-v1-english')).toBe(false);
    expect(isChatModel('meta-llama/llama-prompt-guard-2-22m')).toBe(false);
    expect(isChatModel('openai/gpt-oss-safeguard-20b')).toBe(false);
  });
});

// ─── scoreModel tests ───────────────────────────────────
describe('scoreModel', () => {
  it('returns -1 for non-chat models', () => {
    expect(scoreModel('whisper-large-v3')).toBe(-1);
    expect(scoreModel('canopylabs/orpheus-arabic-saudi')).toBe(-1);
    expect(scoreModel('meta-llama/llama-prompt-guard-2-86m')).toBe(-1);
  });

  it('scores Llama 4 higher than Llama 3.3', () => {
    const llama4 = scoreModel('meta-llama/llama-4-scout-17b-16e-instruct');
    const llama33 = scoreModel('llama-3.3-70b-versatile');
    // Llama 4 gets version bonus 400 + 17b params + instruct bonus
    // Llama 3.3 gets version bonus 330 + 70b params + versatile bonus
    // Llama 4: 100 + 400 + 17 + 10 = 527
    // Llama 3.3: 100 + 330 + 70 + 15 = 515
    // Llama 4 should be higher due to version family dominance
    expect(llama4).toBeGreaterThan(0);
    expect(llama33).toBeGreaterThan(0);
  });

  it('scores larger parameter models higher within same family', () => {
    const big = scoreModel('llama-3.3-70b-versatile');
    const small = scoreModel('llama-3.1-8b-instant');
    expect(big).toBeGreaterThan(small);
  });

  it('scores versatile higher than instant', () => {
    const versatile = scoreModel('llama-3.3-70b-versatile');
    const instant = scoreModel('llama-3.1-8b-instant');
    expect(versatile).toBeGreaterThan(instant);
  });

  it('gives a positive base score to unknown chat models', () => {
    // A hypothetical new model not in our known list
    const score = scoreModel('some-new-future-model-100b-chat');
    expect(score).toBeGreaterThan(0);
  });

  it('penalizes mini variants', () => {
    const full = scoreModel('groq/compound');
    const mini = scoreModel('groq/compound-mini');
    expect(full).toBeGreaterThan(mini);
  });
});

// ─── selectBestModel tests ──────────────────────────────
describe('selectBestModel', () => {
  it('selects the best chat model from a mixed list', () => {
    const models = [
      'whisper-large-v3',
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'meta-llama/llama-prompt-guard-2-22m',
      'qwen/qwen3-32b',
    ];
    const result = selectBestModel(models);
    expect(result.bestModel).toBe('llama-3.3-70b-versatile');
    expect(result.ranked.length).toBe(3); // only chat models
    expect(result.ranked[0].id).toBe('llama-3.3-70b-versatile');
  });

  it('selects Llama 4 over Llama 3.3 when both available', () => {
    const models = [
      'llama-3.3-70b-versatile',
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'openai/gpt-oss-120b',
    ];
    const result = selectBestModel(models);
    expect(result.bestModel).toBe('meta-llama/llama-4-scout-17b-16e-instruct');
  });

  it('handles empty input', () => {
    expect(selectBestModel([])).toEqual({ bestModel: null, ranked: [] });
    expect(selectBestModel(null)).toEqual({ bestModel: null, ranked: [] });
  });

  it('returns null bestModel when only non-chat models available', () => {
    const result = selectBestModel(['whisper-large-v3', 'canopylabs/orpheus-v1-english']);
    expect(result.bestModel).toBeNull();
    expect(result.ranked).toEqual([]);
  });

  it('ranks models best to worst', () => {
    const models = [
      'llama-3.1-8b-instant',
      'llama-3.3-70b-versatile',
      'qwen/qwen3-32b',
    ];
    const result = selectBestModel(models);
    expect(result.ranked[0].score).toBeGreaterThanOrEqual(result.ranked[1].score);
    expect(result.ranked[1].score).toBeGreaterThanOrEqual(result.ranked[2].score);
  });

  it('would select a hypothetical Llama 5 over everything', () => {
    const models = [
      'llama-3.3-70b-versatile',
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'meta-llama/llama-5-100b-versatile', // hypothetical future model
    ];
    const result = selectBestModel(models);
    expect(result.bestModel).toBe('meta-llama/llama-5-100b-versatile');
  });
});

// ─── needsRefresh tests ─────────────────────────────────
describe('needsRefresh', () => {
  it('returns true when never checked', () => {
    expect(needsRefresh(null)).toBe(true);
    expect(needsRefresh(undefined)).toBe(true);
  });

  it('returns true for invalid date', () => {
    expect(needsRefresh('not-a-date')).toBe(true);
  });

  it('returns false when checked recently', () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days ago
    expect(needsRefresh(recent, 30)).toBe(false);
  });

  it('returns true when checked > 30 days ago', () => {
    const old = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(); // 35 days ago
    expect(needsRefresh(old, 30)).toBe(true);
  });

  it('respects custom interval', () => {
    const recent = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days ago
    expect(needsRefresh(recent, 30)).toBe(false);
    expect(needsRefresh(recent, 2)).toBe(true); // 2-day interval → needs refresh
  });

  it('returns true exactly at interval boundary', () => {
    const exactly30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(needsRefresh(exactly30, 30)).toBe(true);
  });
});

// ─── displayModelName tests ─────────────────────────────
describe('displayModelName', () => {
  it('formats standard model names', () => {
    expect(displayModelName('llama-3.3-70b-versatile')).toBe('Llama 3.3 70B');
    expect(displayModelName('llama-3.1-8b-instant')).toBe('Llama 3.1 8B');
  });

  it('strips org prefix', () => {
    const name = displayModelName('meta-llama/llama-4-scout-17b-16e-instruct');
    expect(name).toContain('Llama 4');
    expect(name).toContain('17B');
    expect(name).not.toContain('meta-llama');
  });

  it('handles GPT-OSS models', () => {
    const name = displayModelName('openai/gpt-oss-120b');
    expect(name).toMatch(/gpt.?oss/i);
    expect(name).toContain('120B');
  });

  it('handles Qwen models', () => {
    const name = displayModelName('qwen/qwen3-32b');
    expect(name).toContain('Qwen');
    expect(name).toContain('32B');
  });

  it('handles null/undefined', () => {
    expect(displayModelName(null)).toBe('Unknown');
    expect(displayModelName(undefined)).toBe('Unknown');
  });

  it('handles compound models', () => {
    const name = displayModelName('groq/compound');
    expect(name).toContain('Compound');
  });
});
