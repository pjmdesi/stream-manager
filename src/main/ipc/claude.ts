import { ipcMain } from 'electron'
import { getStore } from './store'

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-haiku-4-5-20251001'

// When the user's cursor is mid-field, generate text to insert at that position.
// When the field is empty (no prefix or suffix), generate the full content.
function buildInstruction(field: string, prefix: string, suffix: string): string {
  const hasCursor = prefix !== '' || suffix !== ''

  if (!hasCursor) {
    // Empty field — generate from scratch
    const full: Record<string, string> = {
      title: 'Generate a YouTube video title for this stream. Keep it under 70 characters, make it engaging and specific to the content. Return ONLY the title text — no quotes, no explanation.',
      description: 'Write a YouTube video description for this stream. 2–4 sentences, informative and engaging. Return ONLY the description text.',
      tags: 'Generate YouTube tags for this stream as a comma-separated list. Include 8–12 relevant tags covering the game, genre, and stream type. Return ONLY the comma-separated tags.',
    }
    return full[field] ?? `Generate the ${field} for this stream. Return ONLY the value.`
  }

  // Cursor is inside existing text — generate what belongs at that position
  const inline: Record<string, string> = {
    title: `Continue or complete this stream title. Text before cursor: "${prefix}". Text after cursor: "${suffix}". Return ONLY the text to insert at the cursor — no surrounding context, no quotes.`,
    description: `Insert text at the cursor position in this stream description.\nText before cursor:\n${prefix}\nText after cursor:\n${suffix}\nReturn ONLY the text to insert. Do not repeat the prefix or suffix.`,
    tags: `Add more YouTube tags to this list. Tags so far: "${prefix}". Return ONLY additional comma-separated tags to append (no duplicates, no leading comma).`,
  }
  return inline[field] ?? `Insert text at the cursor in the ${field} field. Text before: "${prefix}". Text after: "${suffix}". Return ONLY the inserted text.`
}

async function callAnthropic(apiKey: string, system: string, userMessage: string, maxTokens = 512): Promise<Response> {
  return fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
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
    const instruction = buildInstruction(field, prefix, suffix)

    const system = [
      'You are a streaming metadata assistant. Help create YouTube metadata for stream recordings.',
      config.claudeSystemPrompt?.trim() ? `User preferences: ${config.claudeSystemPrompt.trim()}` : '',
      'Always respond with ONLY the requested content — no labels, no markdown, no explanation.',
    ].filter(Boolean).join('\n\n')

    // Strip prefix/suffix from the context object sent as background info
    const { prefix: _p, suffix: _s, ...streamContext } = context
    const userMessage = `Stream context:\n${JSON.stringify(streamContext, null, 2)}\n\nTask: ${instruction}`

    const res = await callAnthropic(apiKey, system, userMessage)
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
      throw new Error(err.error?.message ?? `Anthropic API error ${res.status}`)
    }

    const data = await res.json() as { content?: Array<{ text?: string }> }
    return data.content?.[0]?.text?.trim() ?? null
  })

  ipcMain.handle('claude:testKey', async (_, apiKey: string) => {
    try {
      const res = await callAnthropic(apiKey.trim(), 'You are a test.', 'Reply with just "ok".', 5)
      if (res.ok) return { valid: true }
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
      return { valid: false, error: err.error?.message ?? `Error ${res.status}` }
    } catch (e: unknown) {
      return { valid: false, error: e instanceof Error ? e.message : 'Network error' }
    }
  })
}
