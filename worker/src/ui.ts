import { newCsrf, SessionCtx } from './auth.js';

/**
 * CSP for everything the worker serves. form-action also governs redirects
 * that answer a form submission, so the OAuth consent page widens it to its
 * validated loopback redirect origin (the CLI's callback listener).
 */
export function contentSecurityPolicy(formAction = "'self'"): string {
  return "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; " +
    `form-action ${formAction}`;
}

/**
 * Server-rendered OAuth consent page only — login/register/dashboard moved to
 * the React SPA in webapp/ (served as static assets).
 */

const CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    max-width: 640px; margin: 3rem auto; padding: 0 1rem; line-height: 1.5;
  }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.05rem; margin-top: 2rem; }
  .card { border: 1px solid #8884; border-radius: 10px; padding: 1.25rem 1.5rem; margin: 1rem 0; }
  button, .btn {
    display: inline-block; margin-top: .9rem; padding: .45rem 1.1rem; border-radius: 6px;
    border: 1px solid #8886; background: #4772fa; border-color: #4772fa; color: #fff;
    cursor: pointer; text-decoration: none; font-size: .9rem;
  }
  .muted { color: #888; font-size: .85rem; }
  code { background: #8882; padding: .1rem .35rem; border-radius: 4px; }
`;

export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · NodeTick</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${CSS}</style>
</head>
<body>
<h1>🐘 NodeTick</h1>
${body}
<p class="muted">Self-hosted TickTick-compatible server on Cloudflare Workers.</p>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function consentPage(
  c: SessionCtx,
  params: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    method: string;
    scope: string;
  },
): Promise<string> {
  const csrf = await newCsrf(c);
  return page(
    'Authorize',
    `<div class="card">
      <p><strong>nodetick-cli</strong> is requesting access to your NodeTick account
      with scope <code>${escapeHtml(params.scope)}</code>.</p>
      <p class="muted">It will redirect to <code>${escapeHtml(params.redirectUri)}</code> (loopback).</p>
      <form method="post" action="/oauth/authorize">
        <input type="hidden" name="csrf" value="${csrf}">
        <input type="hidden" name="client_id" value="${escapeHtml(params.clientId)}">
        <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirectUri)}">
        <input type="hidden" name="state" value="${escapeHtml(params.state)}">
        <input type="hidden" name="code_challenge" value="${escapeHtml(params.codeChallenge)}">
        <input type="hidden" name="code_challenge_method" value="${escapeHtml(params.method)}">
        <input type="hidden" name="scope" value="${escapeHtml(params.scope)}">
        <button type="submit" name="decision" value="allow">Authorize</button>
        <button type="submit" name="decision" value="deny" class="btn" style="background:transparent;color:inherit;border-color:#8886">Cancel</button>
      </form>
    </div>`,
  );
}
