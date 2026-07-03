/**
 * email-server — transactional email via Resend (server-only).
 *
 * Graceful: if RESEND_API_KEY is unset, `isEmailConfigured()` is false and
 * `sendEmail` returns false so callers can fall back (e.g. Firebase's own
 * password-reset email). Lights up the moment the key is set in Vercel env.
 *
 * From-address uses the verified domain (cinechrony.com). Override with RESEND_FROM.
 */
import { Resend } from 'resend';

const FROM = process.env.RESEND_FROM || 'cinechrony <noreply@cinechrony.com>';
const REPLY_TO = process.env.RESEND_REPLY_TO || undefined;

// Public, hosted brand logo for emails (data-URIs are unreliable across mail
// clients; a remote https image is the safe choice).
const LOGO_URL = '/brand/cinechrony-icon-bg.png';
const FILM_RED = '#e8543a';
const INK = '#1a1714';
const CREAM = '#f3efe6';
const MUTED = '#8a8175';

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

let _resend: Resend | null = null;
function client(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

/** Send an email. Returns true on success, false if unconfigured or it errored. */
export async function sendEmail(opts: { to: string; subject: string; html: string; text: string }): Promise<boolean> {
  const r = client();
  if (!r) return false;
  const { error } = await r.emails.send({
    from: FROM,
    to: [opts.to],
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    ...(REPLY_TO ? { replyTo: REPLY_TO } : {}),
  });
  if (error) {
    console.error('[email] resend error:', error);
    return false;
  }
  return true;
}

// ── branded template ─────────────────────────────────────────────────────────

/** A simple, robust, table-based branded email shell (inline styles for client
 *  compatibility). `cta` renders a film-red button; `rawUrl` is the visible
 *  fallback link. */
function renderShell(opts: {
  preheader: string;
  heading: string;
  body: string;
  ctaText: string;
  ctaUrl: string;
  footnote: string;
  rawUrl: string;
}): string {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:${CREAM};">
    <span style="display:none;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${opts.preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #ece6d8;">
          <tr><td style="padding:36px 36px 8px;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td style="padding-right:12px;"><img src="${LOGO_URL}" width="40" height="40" alt="cinechrony" style="display:block;border-radius:11px;"></td>
              <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;color:${INK};letter-spacing:-0.5px;">cinechrony</td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:20px 36px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:26px;font-weight:800;color:${INK};letter-spacing:-0.5px;">${opts.heading}</td></tr>
          <tr><td style="padding:14px 36px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55;color:#4a443c;">${opts.body}</td></tr>
          <tr><td style="padding:28px 36px 8px;">
            <a href="${opts.ctaUrl}" style="display:inline-block;background:${FILM_RED};color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:14px;">${opts.ctaText}</a>
          </td></tr>
          <tr><td style="padding:18px 36px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:${MUTED};">${opts.footnote}</td></tr>
          <tr><td style="padding:14px 36px 36px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:${MUTED};word-break:break-all;">${opts.rawUrl}</td></tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;"><tr>
          <td align="center" style="padding:18px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${MUTED};">a social movie watchlist for you and your friends · cinechrony</td>
        </tr></table>
      </td></tr>
    </table>
  </body>
</html>`;
}

/** Branded password-reset email (the secure link comes from the Firebase Admin SDK). */
export async function sendPasswordResetEmail(to: string, resetLink: string): Promise<boolean> {
  const html = renderShell({
    preheader: 'reset your cinechrony password',
    heading: 'reset your password',
    body: 'we got a request to reset the password for your cinechrony account. tap the button below to set a new one. this link expires in an hour.',
    ctaText: 'reset password',
    ctaUrl: resetLink,
    footnote: "if you didn't ask for this, you can safely ignore this email — your password won't change.",
    rawUrl: `or paste this link into your browser: ${resetLink}`,
  });
  const text = `reset your cinechrony password\n\nwe got a request to reset the password for your account. open this link to set a new one (expires in an hour):\n\n${resetLink}\n\nif you didn't ask for this, you can ignore this email.`;
  return sendEmail({ to, subject: 'reset your cinechrony password', html, text });
}
