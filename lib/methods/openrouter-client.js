/**
 * OpenRouter API Client — shared HTTP client for all LLM-based methods.
 *
 * Centralizes the OpenRouter chat-completion call pattern that was
 * previously duplicated across llm.js, llm-coached.js, and their
 * translateContent variants. Each call site only needed to differ in:
 *   - prompt text
 *   - temperature
 *   - timeout multiplier
 *   - log label
 *
 * This module provides two functions:
 *   callOpenRouter()      — raw text response (for content translation)
 *   callOpenRouterJSON()  — parsed + validated JSON (for key-value translation)
 */

import {
  MAX_RETRIES, REQUEST_TIMEOUT_MS,
  isRetryable, getBackoffDelay, sleep, stripCodeFences,
} from './http-utils.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Call OpenRouter's chat completion API with retry and backoff.
 *
 * Returns the raw text content from the model, with code fences stripped.
 * Returns null on permanent failure (non-retryable error or exhausted retries).
 *
 * @param {object} options
 * @param {string} options.prompt - The user message content
 * @param {string} options.apiKey - OpenRouter API key
 * @param {string} options.model - Model identifier (e.g. 'openai/gpt-4o-mini')
 * @param {number} [options.temperature=0.3] - Sampling temperature
 * @param {number} [options.timeoutMs] - Override timeout (default: REQUEST_TIMEOUT_MS)
 * @param {string} [options.label='LLM'] - Label for log messages (e.g. 'Batch 3', 'Coached batch 1')
 * @param {string} [options.xTitle='i18n-rosetta'] - X-Title header value
 * @returns {Promise<string|null>} Model response text, or null on failure
 */
async function callOpenRouter({
  prompt,
  apiKey,
  model,
  temperature = 0.3,
  timeoutMs = REQUEST_TIMEOUT_MS,
  label = 'LLM',
  xTitle = 'i18n-rosetta',
}) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/gamedaysuits/i18n-rosetta',
          'X-Title': xTitle,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Retryable status (429, 5xx) — back off and try again
      if (isRetryable(response.status)) {
        if (attempt < MAX_RETRIES) {
          const delay = getBackoffDelay(attempt);
          console.error(`\n     ⏳ ${label}: ${response.status} — retrying in ${Math.round(delay / 1000)}s...`);
          await sleep(delay);
          continue;
        }
        console.error(`\n     [ERR] ${label}: ${response.status} after ${MAX_RETRIES + 1} attempts`);
        return null;
      }

      if (!response.ok) {
        console.error(`\n     [ERR] ${label}: API error ${response.status}`);
        return null;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) {
        console.error(`\n     [ERR] ${label}: empty response from model`);
        return null;
      }

      // Strip markdown code fences if the model wraps its response
      return stripCodeFences(content);

    } catch (err) {
      const isTimeout = err.name === 'AbortError';
      const errLabel = isTimeout ? 'timeout' : err.message;

      if (attempt < MAX_RETRIES) {
        const delay = getBackoffDelay(attempt);
        console.error(`\n     ⏳ ${label}: ${errLabel} — retrying in ${Math.round(delay / 1000)}s...`);
        await sleep(delay);
        continue;
      }

      console.error(`\n     [ERR] ${label} failed: ${errLabel}`);
      return null;
    }
  }

  return null;
}

/**
 * Call OpenRouter and parse the response as validated JSON key-value pairs.
 *
 * This is the standard pattern for key-value batch translation:
 *   1. Send prompt to model
 *   2. Parse JSON response
 *   3. Validate: only accept keys from expectedKeys set
 *   4. Block prototype-pollution keys
 *
 * @param {object} options - Same as callOpenRouter, plus:
 * @param {Set<string>} options.expectedKeys - Set of keys to accept in the response
 * @param {function} options.isUnsafeKey - Function to check for unsafe key segments
 * @returns {Promise<object|null>} Validated key-value map, or null on failure
 */
async function callOpenRouterJSON({ expectedKeys, isUnsafeKey, ...callOptions }) {
  const content = await callOpenRouter(callOptions);
  if (!content) return null;

  try {
    const parsed = JSON.parse(content);

    // Validate: only accept keys we sent, block prototype pollution
    const validated = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (expectedKeys.has(key) && typeof value === 'string' && !isUnsafeKey(key)) {
        validated[key] = value;
      }
    }

    return Object.keys(validated).length > 0 ? validated : null;
  } catch (err) {
    console.error(`\n     [ERR] ${callOptions.label || 'LLM'}: JSON parse error — ${err.message}`);
    return null;
  }
}

export { callOpenRouter, callOpenRouterJSON, OPENROUTER_URL };
