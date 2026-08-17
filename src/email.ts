import { config } from "./config";

// Pengiriman email lewat Resend HTTP API (https://api.resend.com/emails).
// Dipakai (bukan SMTP) karena banyak host cloud termasuk Railway plan
// Free/Trial/Hobby memblokir outbound SMTP sepenuhnya — HTTP API jalan
// lewat port 443 biasa sehingga tidak kena blokir itu.
async function send(to: string, subject: string, html: string): Promise<boolean> {
  if (!config.email.resendApiKey) {
    console.warn(
      `[email] RESEND_API_KEY belum diisi — email ke ${to} ("${subject}") TIDAK dikirim.`
    );
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.email.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${config.email.fromName} <${config.email.fromAddress}>`,
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[email] Gagal kirim email ke ${to}: HTTP ${res.status} — ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[email] Gagal kirim email ke ${to}:`, err);
    return false;
  }
}

const wrapper = (title: string, bodyHtml: string) => `
  <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1a1d23;">
    <div style="text-align:center; margin-bottom: 24px;">
      <div style="display:inline-block; width:40px; height:40px; border-radius:50%; background:linear-gradient(135deg,#2563eb,#1e40af); color:#fff; font-weight:700; font-size:18px; line-height:40px;">C</div>
      <div style="font-weight:700; font-size:15px; margin-top:8px; color:#111827;">CakapCepat</div>
    </div>
    <h2 style="font-size:18px; margin: 0 0 12px;">${title}</h2>
    ${bodyHtml}
    <p style="font-size:12px; color:#9ca3af; margin-top:32px;">
      Kalau kamu tidak merasa melakukan permintaan ini, abaikan saja email ini.
    </p>
  </div>
`;

export async function sendVerificationEmail(to: string, name: string, token: string) {
  const link = `${config.appUrl}/verify-email?token=${token}`;
  const html = wrapper(
    "Verifikasi email kamu",
    `
      <p>Hai ${name},</p>
      <p>Terima kasih sudah mendaftar di CakapCepat. Klik tombol di bawah untuk memverifikasi email kamu:</p>
      <p style="text-align:center; margin: 28px 0;">
        <a href="${link}" style="background:#2563eb; color:#fff; text-decoration:none; padding:12px 28px; border-radius:8px; font-weight:600; display:inline-block;">Verifikasi Email</a>
      </p>
      <p style="font-size:13px; color:#6b7280;">Atau salin link ini ke browser kamu:<br/>${link}</p>
      <p style="font-size:13px; color:#6b7280;">Link ini berlaku selama 24 jam.</p>
    `
  );
  return send(to, "Verifikasi email CakapCepat kamu", html);
}

export async function sendResetPasswordEmail(to: string, name: string, token: string) {
  const link = `${config.appUrl}/reset-password?token=${token}`;
  const html = wrapper(
    "Reset password kamu",
    `
      <p>Hai ${name},</p>
      <p>Kami menerima permintaan untuk reset password akun CakapCepat kamu. Klik tombol di bawah untuk membuat password baru:</p>
      <p style="text-align:center; margin: 28px 0;">
        <a href="${link}" style="background:#2563eb; color:#fff; text-decoration:none; padding:12px 28px; border-radius:8px; font-weight:600; display:inline-block;">Reset Password</a>
      </p>
      <p style="font-size:13px; color:#6b7280;">Atau salin link ini ke browser kamu:<br/>${link}</p>
      <p style="font-size:13px; color:#6b7280;">Link ini berlaku selama 1 jam.</p>
    `
  );
  return send(to, "Reset password CakapCepat kamu", html);
}
