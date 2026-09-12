/**
 * Groq Model Auto-Selector
 *
 * Scores available Groq models and picks the best one for chat/commentary.
 * Designed to be future-proof: when Groq releases a new model (e.g., Llama 5,
 * GPT-OSS 200B), the scoring heuristic automatically ranks it higher without
 * requiring a code change.
 *
 * Constitution Principle II: pure functions, no I/O, no DOM.
 *
 * Scoring philosophy:
 *   - Version family is the primary signal (Llama 4 > Llama 3.3 > Llama 3.1)
 *   - Parameter count is the secondary signal (70B > 32B > 8B)
 *   - Chat-tuned variants get a bonus ("versatile", "instruct")
 *   - Non-chat models are excluded entirely (whisper, orpheus, prompt-guard)
 *   - "instant"/"mini" variants get a small penalty (optimized for speed, not capability)
 */

// Models that are NOT chat/instruct models — excluded from selection
const NON_CHAT_PATTERNS = [
  'whisper',       // speech-to-text
  'orpheus',       // TTS
  'prompt-guard',  // safety classifier
  'safeguard',     // safety classifier
  'canopylabs',    // TTS
  'tts',           // text-to-speech
];

/**
 * Check if a model ID is a chat/instruct model (not speech/safety/etc).
 * @param {string} modelId
 * @returns {boolean}
 */
export function isChatModel(modelId) {
  const id = modelId.toLowerCase();
  return !NON_CHAT_PATTERNS.some((p) => id.includes(p));
}

/**
 * Score a single model by capability. Higher = better.
 *
 * Scoring breakdown:
 *   - Version family bonus:   300–500+ points (Llama 5 > 4 > 3.3 > 3.1 > 3)
 *   - Parameter size bonus:   8–120 points (scaled by param count)
 *   - Chat-tuned bonus:       +10 for "versatile" or "instruct"
 *   - Speed-variant penalty:  -5 for "instant", -10 for "mini"
 *   - Unknown models:         base score of 100 (so new models are considered)
 *
 * @param {string} modelId — e.g. "llama-3.3-70b-versatile"
 * @returns {number} score (0+ for chat models, -1 for non-chat models)
 */
export function scoreModel(modelId) {
  const id = modelId.toLowerCase();

  // Exclude non-chat models
  if (!isChatModel(modelId)) return -1;

  let score = 100; // base score for any unknown chat model

  // ─── Version family bonus ───────────────────────────
  // Higher version = newer release = preferred
  if (id.includes('llama-5') || id.includes('llama5')) score += 500;
  else if (id.includes('llama-4') || id.includes('llama4')) score += 400;
  else if (id.includes('llama-3.3')) score += 330;
  else if (id.includes('llama-3.1')) score += 310;
  else if (id.includes('llama-3')) score += 300;
  else if (id.includes('gpt-oss')) score += 250;
  else if (id.includes('qwen3.6') || id.includes('qwen-3.6')) score += 180;
  else if (id.includes('qwen3') || id.includes('qwen-3')) score += 170;
  else if (id.includes('qwen2')) score += 120;
  else if (id.includes('compound')) score += 150;
  else if (id.includes('allam')) score += 80;
  else if (id.includes('mixtral')) score += 140;
  else if (id.includes('gemma')) score += 110;

  // ─── Parameter size bonus ───────────────────────────
  // Larger params = more capable (generally)
  if (id.includes('120b') || id.includes('120b')) score += 120;
  else if (id.includes('70b')) score += 70;
  else if (id.includes('32b')) score += 32;
  else if (id.includes('27b')) score += 27;
  else if (id.includes('20b')) score += 20;
  else if (id.includes('17b')) score += 17;
  else if (id.includes('8b')) score += 8;
  else if (id.includes('7b')) score += 7;
  else if (id.includes('3b') || id.includes('2b') || id.includes('1b')) score += 3;

  // ─── Chat-tuned variant bonus ───────────────────────
  if (id.includes('versatile')) score += 15;
  if (id.includes('instruct')) score += 10;
  if (id.includes('chat')) score += 5;

  // ─── Speed-variant penalty ──────────────────────────
  // "instant" and "mini" are optimized for speed, not peak capability
  if (id.includes('instant')) score -= 5;
  if (id.includes('mini')) score -= 10;
  if (id.includes('turbo')) score -= 3;

  return score;
}

/**
 * Select the best available chat model from a list of model IDs.
 *
 * @param {string[]} modelIds — e.g. ["llama-3.3-70b-versatile", "whisper-large-v3", ...]
 * @returns {{bestModel: string|null, ranked: {id: string, score: number}[]}}
 *   bestModel is null if no chat models are available.
 *   ranked is sorted best → worst (only chat models included).
 */
export function selectBestModel(modelIds) {
  if (!modelIds || !modelIds.length) return { bestModel: null, ranked: [] };

  const scored = modelIds
    .map((id) => ({ id, score: scoreModel(id) }))
    .filter((m) => m.score > 0) // exclude non-chat models
    .sort((a, b) => b.score - a.score);

  return {
    bestModel: scored.length > 0 ? scored[0].id : null,
    ranked: scored,
  };
}

/**
 * Check if the monthly refresh interval has elapsed.
 *
 * @param {string|Date|null} lastCheckedAt — ISO timestamp of last check
 * @param {number} intervalDays — refresh interval in days (default 30)
 * @returns {boolean} true if a refresh is needed (or never checked)
 */
export function needsRefresh(lastCheckedAt, intervalDays = 30) {
  if (!lastCheckedAt) return true;
  const last = new Date(lastCheckedAt);
  if (isNaN(last.getTime())) return true;
  const elapsed = Date.now() - last.getTime();
  return elapsed >= intervalDays * 24 * 60 * 60 * 1000;
}

/**
 * Human-readable model name for display.
 * e.g. "llama-3.3-70b-versatile" → "Llama 3.3 70B"
 * e.g. "meta-llama/llama-4-scout-17b-16e-instruct" → "Llama 4 Scout 17B"
 *
 * @param {string} modelId
 * @returns {string}
 */
export function displayModelName(modelId) {
  if (!modelId) return 'Unknown';
  // Strip org prefix (e.g., "meta-llama/")
  let name = modelId.replace(/^[^/]+\//, '');
  // Capitalize
  name = name.replace(/llama/gi, 'Llama');
  name = name.replace(/gpt-oss/gi, 'GPT-OSS');
  name = name.replace(/qwen/gi, 'Qwen');
  name = name.replace(/mixtral/gi, 'Mixtral');
  name = name.replace(/gemma/gi, 'Gemma');
  name = name.replace(/compound/gi, 'Compound');
  name = name.replace(/allam/gi, 'Allam');
  // Remove variant suffixes for display
  name = name.replace(/[-_](versatile|instruct|chat|instant|turbo|mini)/gi, '');
  // Clean up extra dashes/spaces
  name = name.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  // Uppercase param sizes (e.g., "70b" → "70B")
  name = name.replace(/(\d+)b/gi, '$1B');
  return name;
}
