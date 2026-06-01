import { Resend } from 'resend';

// Email is sent via Resend. Set RESEND_API_KEY and EMAIL_FROM in the environment.
// In development (or when the key is missing) we fall back to logging the OTP to the
// server console so the flow stays testable without a provider configured.
function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

function fromAddress(): string {
  return process.env.EMAIL_FROM || 'Kushal Automation <onboarding@resend.dev>';
}

export async function sendVerificationEmail(to: string, code: string): Promise<void> {
  const resend = getResend();

  if (!resend) {
    // No provider configured — log so the dev flow still works.
    console.log(`\n[email] Verification code for ${to}: ${code}\n`);
    return;
  }

  const { error } = await resend.emails.send({
    from: fromAddress(),
    to,
    subject: `${code} is your verification code`,
    html: verificationHtml(code),
    text: `Your Kushal Automation verification code is ${code}. It expires in 10 minutes.`,
  });

  if (error) {
    console.error('[email] Resend error', error);
    throw new Error('Failed to send verification email');
  }
}

function verificationHtml(code: string): string {
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;color:#0f172a">
    <div style="font-size:20px;font-weight:700;margin-bottom:8px">🚀 Kushal Automation</div>
    <p style="font-size:15px;color:#475569;margin:0 0 24px">Use the code below to verify your email address.</p>
    <div style="font-size:36px;font-weight:800;letter-spacing:10px;background:#f1f5f9;border-radius:12px;padding:20px;text-align:center;color:#0f172a">${code}</div>
    <p style="font-size:13px;color:#94a3b8;margin:24px 0 0">This code expires in 10 minutes. If you didn't request it, you can ignore this email.</p>
  </div>`;
}
