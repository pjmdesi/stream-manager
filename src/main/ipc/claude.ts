import { ipcMain } from 'electron'
import { getStore } from './store'

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_MODELS_API = 'https://api.anthropic.com/v1/models'
// Fallback when the user hasn't picked a model yet. Sonnet 4.6 is a much
// stronger default than the old Haiku hardcode for metadata/tag generation
// while staying inexpensive; users can switch to any model their account
// has access to via the Integrations → Claude AI dropdown.
const DEFAULT_MODEL = 'claude-sonnet-4-6'

// When the user's cursor is mid-field, generate text to insert at that position.
// When the field is empty (no prefix or suffix), generate the full content.
//
// For tag fields, `prefix` is just whatever the user has typed into the
// add-tag input — NOT the existing chips. The existing chip list comes
// in via context (`currentYtTags` / `currentTwitchTags`) and is the
// source of truth for "what tags already exist." We thread it into the
// prompt explicitly so Claude can avoid duplicating chips.
function buildInstruction(
  field: string,
  prefix: string,
  suffix: string,
  ctx: { currentYtTags?: string[]; currentTwitchTags?: string[]; previousTaglines?: string[] },
): string {
  const hasCursor = prefix !== '' || suffix !== ''
  const ytExisting = ctx.currentYtTags?.length
    ? `Existing YouTube tags (do NOT suggest any of these): ${ctx.currentYtTags.join(', ')}.`
    : ''
  const twExisting = ctx.currentTwitchTags?.length
    ? `Existing Twitch tags (do NOT suggest any of these): ${ctx.currentTwitchTags.join(', ')}.`
    : ''
  const prevTaglinesText = ctx.previousTaglines?.length
    ? `Previous taglines in this series (do NOT repeat or closely paraphrase any of these): ${ctx.previousTaglines.map(t => `"${t}"`).join(', ')}.`
    : ''

  if (!hasCursor) {
    // Empty field — generate from scratch
    const full: Record<string, string> = {
      title: 'Generate a YouTube video title for this stream. Keep it under 70 characters, make it engaging and specific to the content. Return ONLY the title text — no quotes, no explanation.',
      description: 'Write a YouTube video description for this stream. 2–4 sentences, informative and engaging. Return ONLY the description text.',
      tagline: `Generate a short catchy tagline for this stream — 3 to 8 words that capture what happens or the vibe of the session. The tagline substitutes into a title template's {tagline} slot, so it should sit naturally inside a longer title. Ground the suggestion in the topic/game, description, and existing tags when those are present. ${prevTaglinesText} Return ONLY the tagline text — no quotes, no explanation, no trailing punctuation.`.trim(),
      tags: `Generate YouTube tags for this stream as a comma-separated list. Include 8–12 relevant tags covering the game, genre, and stream type. ${ytExisting} Return ONLY the comma-separated tags.`.trim(),
      'twitch-tags': `Generate Twitch channel tags for this stream as a comma-separated list. Twitch rules: alphanumeric only (no spaces, no punctuation), up to 25 characters per tag, maximum 10 tags total. Pick the most relevant tags covering the game, genre, and stream type. ${twExisting} Return ONLY the comma-separated tags.`.trim(),
    }
    return full[field] ?? `Generate the ${field} for this stream. Return ONLY the value.`
  }

  // Cursor is inside existing text — generate what belongs at that position
  const inline: Record<string, string> = {
    title: `Continue or complete this stream title. Text before cursor: "${prefix}". Text after cursor: "${suffix}". Return ONLY the text to insert at the cursor — no surrounding context, no quotes.`,
    description: `Insert text at the cursor position in this stream description.\nText before cursor:\n${prefix}\nText after cursor:\n${suffix}\nReturn ONLY the text to insert. Do not repeat the prefix or suffix.`,
    tagline: `Complete this tagline. Text before cursor: "${prefix}". Text after cursor: "${suffix}". A tagline is a short catchy phrase (3–8 words total when combined) that substitutes into a title template's {tagline} slot. ${prevTaglinesText} Return ONLY the text to insert at the cursor — no quotes, no surrounding context.`.trim(),
    tags: `Suggest 1–4 additional YouTube tags. The user is currently typing: "${prefix}". ${ytExisting} Return ONLY a comma-separated list of new tags — no duplicates of existing tags, no leading comma.`.trim(),
    'twitch-tags': `Suggest 1–4 additional Twitch channel tags. The user is currently typing: "${prefix}". ${twExisting} Twitch rules: alphanumeric only (no spaces, no punctuation), up to 25 characters per tag, maximum 10 tags total — stay within the remaining budget. Return ONLY a comma-separated list of new tags — no duplicates of existing tags, no leading comma.`.trim(),
  }
  return inline[field] ?? `Insert text at the cursor in the ${field} field. Text before: "${prefix}". Text after: "${suffix}". Return ONLY the inserted text.`
}

async function callAnthropic(apiKey: string, model: string, system: string, userMessage: string, maxTokens = 512): Promise<Response> {
  return fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })
}

export function registerClaudeIPC() {
  ipcMain.handle('claude:generate', async (_, { field, context }: { field: string; context: Record<string, unknown> }) => {
    const config = getStore().get('config')
    const apiKey = config.claudeApiKey?.trim()
    if (!apiKey) throw new Error('No Claude API key configured')

    const prefix = String(context.prefix ?? '')
    const suffix = String(context.suffix ?? '')
    const currentYtTags = Array.isArray(context.currentYtTags) ? context.currentYtTags as string[] : undefined
    const currentTwitchTags = Array.isArray(context.currentTwitchTags) ? context.currentTwitchTags as string[] : undefined
    const previousTaglines = Array.isArray(context.previousTaglines) ? context.previousTaglines as string[] : undefined
    const instruction = buildInstruction(field, prefix, suffix, { currentYtTags, currentTwitchTags, previousTaglines })

    const system = [
      'You are a streaming metadata assistant. Help create YouTube metadata for stream recordings.',
      config.claudeSystemPrompt?.trim() ? `User preferences: ${config.claudeSystemPrompt.trim()}` : '',
      'Always respond with ONLY the requested content — no labels, no markdown, no explanation.',
    ].filter(Boolean).join('\n\n')

    // Strip prefix/suffix from the context object sent as background info
    const { prefix: _p, suffix: _s, ...streamContext } = context
    const userMessage = `Stream context:\n${JSON.stringify(streamContext, null, 2)}\n\nTask: ${instruction}`

    const model = config.claudeModel?.trim() || DEFAULT_MODEL
    const res = await callAnthropic(apiKey, model, system, userMessage)
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
      throw new Error(err.error?.message ?? `Anthropic API error ${res.status}`)
    }

    const data = await res.json() as { content?: Array<{ text?: string }> }
    return data.content?.[0]?.text?.trim() ?? null
  })

  ipcMain.handle('claude:testKey', async (_, apiKey: string) => {
    try {
      const config = getStore().get('config')
      const model = config.claudeModel?.trim() || DEFAULT_MODEL
      const res = await callAnthropic(apiKey.trim(), model, 'You are a test.', 'Reply with just "ok".', 5)
      if (res.ok) return { valid: true }
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
      return { valid: false, error: err.error?.message ?? `Error ${res.status}` }
    } catch (e: unknown) {
      return { valid: false, error: e instanceof Error ? e.message : 'Network error' }
    }
  })

  // List the models the connected account actually has access to, so the
  // settings dropdown only offers valid choices (free vs. paid tiers differ).
  // Returns newest-first as the API already orders them. The API key is
  // passed directly (may be unsaved/just-typed in the settings field).
  ipcMain.handle('claude:listModels', async (_, apiKey: string) => {
    const key = apiKey?.trim()
    if (!key) return { ok: false as const, error: 'No API key' }
    try {
      const res = await fetch(`${ANTHROPIC_MODELS_API}?limit=1000`, {
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
        return { ok: false as const, error: err.error?.message ?? `Error ${res.status}` }
      }
      const data = await res.json() as { data?: Array<{ id?: string; display_name?: string }> }
      const models = (data.data ?? [])
        .filter(m => typeof m.id === 'string')
        .map(m => ({ id: m.id as string, displayName: m.display_name ?? (m.id as string) }))
      return { ok: true as const, models }
    } catch (e: unknown) {
      return { ok: false as const, error: e instanceof Error ? e.message : 'Network error' }
    }
  })
}
