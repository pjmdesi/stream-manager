/**
 * The browser page shown at the end of an OAuth flow (the localhost
 * callback both youtubeAuth and twitchAuth serve). Styled to match the
 * app's modal design: navy stage, navy-700 card, white/10 border,
 * rounded-xl. Colors are the style guide's hex tokens written literally
 * since no Tailwind exists in a served page.
 *
 * The old inline pages had no charset declaration, so the UTF-8 check
 * mark rendered as mojibake ("âœ“"); the icons are inline SVG now and the
 * charset is declared anyway.
 */
export function oauthResultPage(opts: { ok: boolean; service: 'YouTube' | 'Twitch' }): string {
  const { ok, service } = opts
  const icon = ok
    ? `<div style="width:3rem;height:3rem;margin:0 auto 1.25rem;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.35)">
         <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
       </div>`
    : `<div style="width:3rem;height:3rem;margin:0 auto 1.25rem;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:rgba(248,113,113,0.12);border:1px solid rgba(248,113,113,0.35)">
         <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
       </div>`
  const title = ok ? `Connected to ${service}` : 'Connection failed'
  const body = ok
    ? `You&rsquo;re all set. Stream Manager finishes the connection automatically &mdash; close this tab and head back to the app.`
    : `${service} reported an error during sign-in. Close this tab and return to Stream Manager, where the details are shown &mdash; you can try connecting again from there.`
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stream Manager</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0f1a;font-family:'Segoe UI',system-ui,-apple-system,sans-serif">
  <div style="background:#1c2333;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:2.5rem 3rem;max-width:26rem;margin:1rem;text-align:center;box-shadow:0 25px 50px -12px rgba(0,0,0,0.6)">
    ${icon}
    <h1 style="margin:0 0 0.5rem;font-size:1.125rem;font-weight:600;color:#ffffff">${title}</h1>
    <p style="margin:0;font-size:0.8125rem;line-height:1.6;color:#9ca3af">${body}</p>
    <p style="margin:1.25rem 0 0;font-size:0.6875rem;color:#6b7280">Stream Manager</p>
  </div>
</body>
</html>`
}
