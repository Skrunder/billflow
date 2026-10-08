import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from './logger';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.smtpEnabled) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
  }
  return transporter;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Returns false (without throwing) when SMTP is not configured. */
export async function sendMail(mail: Mail): Promise<boolean> {
  const t = getTransporter();
  if (!t) {
    logger.warn({ to: mail.to, subject: mail.subject }, 'SMTP not configured — email not sent');
    return false;
  }
  await t.sendMail({ from: env.SMTP_FROM, ...mail });
  logger.info({ to: mail.to, subject: mail.subject }, 'email sent');
  return true;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function simpleHtml(title: string, paragraphs: string[], link?: { href: string; label: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`).join('');
  const button = link
    ? `<p><a href="${escapeHtml(link.href)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${escapeHtml(link.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#111827;max-width:560px;margin:auto;padding:24px">
<h2 style="margin:0 0 16px">${escapeHtml(title)}</h2>${body}${button}
<p style="color:#6b7280;font-size:12px;margin-top:32px">Sent by BillFlow</p></body></html>`;
}
