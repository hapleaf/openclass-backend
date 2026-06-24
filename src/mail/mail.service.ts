import { Injectable } from '@nestjs/common';
import  nodemailer from 'nodemailer';

const BRAND = {
  ink:       '#0f1410',
  leaf:      '#1d6b3c',
  leafLight: '#d4ead9',
  cream:     '#faf7f2',
  border:    '#e2ded6',
  muted:     '#6b7a72',
  white:     '#ffffff',
};

function baseTemplate(preheader: string, bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <title>OpenWebinar</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.cream};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">

  <!-- Preheader (hidden preview text) -->
  <div style="display:none;max-height:0;overflow:hidden;color:${BRAND.cream};">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.cream};">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <!-- Card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

          <!-- Logo header -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color:${BRAND.leaf};border-radius:14px;padding:10px 22px;">
                    <span style="font-size:20px;font-weight:700;color:${BRAND.white};letter-spacing:-0.5px;font-family:Georgia,serif;">OpenWebinar</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td style="background-color:${BRAND.white};border-radius:20px;border:1px solid ${BRAND.border};overflow:hidden;">

              <!-- Green accent strip -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="height:5px;background:linear-gradient(90deg,${BRAND.leaf},#2d9c5a);font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>

              <!-- Body -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:40px 44px 44px;">
                    ${bodyContent}
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0 0 6px;font-size:12px;color:${BRAND.muted};line-height:1.6;">
                You're receiving this email because you signed up for OpenWebinar.
              </p>
              <p style="margin:0;font-size:12px;color:${BRAND.muted};">
                &copy; ${new Date().getFullYear()} OpenWebinar &mdash; Live Webinar Platform
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

function codeBlock(code: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="background-color:${BRAND.cream};border:2px dashed ${BRAND.border};border-radius:14px;padding:20px 40px;text-align:center;">
                <span style="font-size:38px;font-weight:700;letter-spacing:10px;color:${BRAND.ink};font-family:'Courier New',Courier,monospace;">${code}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
}

function heading(emoji: string, text: string): string {
  return `
    <div style="text-align:center;margin-bottom:28px;">
      <div style="font-size:44px;line-height:1;margin-bottom:16px;">${emoji}</div>
      <h1 style="margin:0;font-size:24px;font-weight:700;color:${BRAND.ink};font-family:Georgia,serif;letter-spacing:-0.5px;line-height:1.25;">${text}</h1>
    </div>`;
}

function para(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#3a4140;">${text}</p>`;
}

function pill(label: string): string {
  return `<span style="display:inline-block;background-color:${BRAND.leafLight};color:${BRAND.leaf};font-size:12px;font-weight:600;padding:3px 10px;border-radius:100px;">${label}</span>`;
}

function divider(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td style="border-top:1px solid ${BRAND.border};font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
}

function smallNote(text: string): string {
  return `<p style="margin:0;font-size:12px;line-height:1.6;color:${BRAND.muted};">${text}</p>`;
}

@Injectable()
export class MailService {
  private transporter: ReturnType<typeof nodemailer.createTransport>;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendVerification(email: string, name: string | null | undefined, code: string) {
    const from = process.env.FROM_EMAIL || `noreply@localhost`;
    const firstName = name?.split(' ')[0] || 'there';

    const body = `
      ${heading('🎓', 'Verify your email address')}
      ${para(`Hey ${firstName}, welcome to <strong>OpenWebinar</strong>! We're excited to have you join our live webinar community.`)}
      ${para(`Use the verification code below to confirm your email address and activate your account:`)}
      ${codeBlock(code)}
      ${para(`This code expires in <strong>30 minutes</strong>. Enter it on the verification screen to get started.`)}
      ${divider()}
      ${pill('Security tip')}
      ${smallNote('OpenWebinar will never ask for this code over the phone or by email. If you didn\'t create an account, you can safely ignore this message.')}
    `;

    const html = baseTemplate(`Your OpenWebinar verification code is ${code}`, body);
    return this.transporter.sendMail({ from, to: email, subject: `${code} is your OpenWebinar verification code`, html });
  }

  async sendContactReply(to: string, recipientName: string, originalSubject: string, replyBody: string) {
    const from = process.env.FROM_EMAIL || `noreply@localhost`;
    const firstName = recipientName.split(' ')[0] || 'there';
    const escaped = replyBody.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');

    const body = `
      ${heading('✉️', 'Re: ' + originalSubject)}
      ${para(`Hi ${firstName},`)}
      <div style="background-color:${BRAND.cream};border-left:3px solid ${BRAND.leaf};border-radius:0 8px 8px 0;padding:16px 20px;margin:0 0 20px;">
        <p style="margin:0;font-size:15px;line-height:1.7;color:${BRAND.ink};">${escaped}</p>
      </div>
      ${divider()}
      ${smallNote('This is a reply from the OpenWebinar team. You can reply directly to this email to continue the conversation.')}
    `;

    const html = baseTemplate(`Re: ${originalSubject}`, body);
    return this.transporter.sendMail({
      from: `"OpenWebinar Team" <${from}>`,
      to,
      replyTo: from,
      subject: `Re: ${originalSubject}`,
      html,
    });
  }

  async sendSessionApproved(email: string, name: string | null, sessionTitle: string, sessionId: number) {
    const from = process.env.FROM_EMAIL || `noreply@localhost`;
    const firstName = name?.split(' ')[0] || 'there';
    const sessionUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/session/${sessionId}`;

    const body = `
      ${heading('🎉', 'Your session is approved!')}
      ${para(`Hi ${firstName}, great news — your session has been reviewed and approved by the OpenWebinar team.`)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
        <tr>
          <td style="background-color:${BRAND.cream};border-left:4px solid ${BRAND.leaf};border-radius:0 10px 10px 0;padding:16px 20px;">
            <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.muted};">Session</p>
            <p style="margin:0;font-size:16px;font-weight:700;color:${BRAND.ink};">${sessionTitle}</p>
          </td>
        </tr>
      </table>
      ${para(`Your session is now <strong>live and discoverable</strong> by attendees on OpenWebinar. Share the link to spread the word!`)}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;">
        <tr>
          <td style="border-radius:10px;background-color:${BRAND.leaf};">
            <a href="${sessionUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:${BRAND.white};text-decoration:none;font-family:Georgia,serif;">View Your Session →</a>
          </td>
        </tr>
      </table>
      ${divider()}
      ${smallNote('You\'ll receive notifications when attendees register for your session. Questions? Reply to this email and we\'ll help.')}
    `;

    const html = baseTemplate(`Your session "${sessionTitle}" has been approved`, body);
    return this.transporter.sendMail({
      from: `"OpenWebinar Team" <${from}>`,
      to: email,
      subject: `✅ "${sessionTitle}" is approved and live on OpenWebinar`,
      html,
    });
  }

  async sendSessionRejected(email: string, name: string | null, sessionTitle: string, reason?: string) {
    const from = process.env.FROM_EMAIL || `noreply@localhost`;
    const firstName = name?.split(' ')[0] || 'there';
    const dashboardUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/my-sessions`;

    const reasonBlock = reason
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
          <tr>
            <td style="background-color:${BRAND.cream};border-left:4px solid #e8a020;border-radius:0 10px 10px 0;padding:16px 20px;">
              <p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.muted};">Feedback from the team</p>
              <p style="margin:0;font-size:14px;line-height:1.7;color:${BRAND.ink};">${reason}</p>
            </td>
          </tr>
        </table>`
      : '';

    const body = `
      ${heading('📋', 'Session needs a few changes')}
      ${para(`Hi ${firstName}, our team has reviewed your session and it needs a few updates before it can go live.`)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
        <tr>
          <td style="background-color:${BRAND.cream};border-left:4px solid ${BRAND.border};border-radius:0 10px 10px 0;padding:16px 20px;">
            <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.muted};">Session</p>
            <p style="margin:0;font-size:16px;font-weight:700;color:${BRAND.ink};">${sessionTitle}</p>
          </td>
        </tr>
      </table>
      ${reasonBlock}
      ${para(`Please update your session based on the feedback above and resubmit — we review submissions quickly and want to get you live as soon as possible.`)}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;">
        <tr>
          <td style="border-radius:10px;background-color:${BRAND.ink};">
            <a href="${dashboardUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:${BRAND.white};text-decoration:none;font-family:Georgia,serif;">Edit in My Sessions →</a>
          </td>
        </tr>
      </table>
      ${divider()}
      ${smallNote('If you have any questions about the feedback, reply to this email and our team will be happy to help.')}
    `;

    const html = baseTemplate(`Action needed on your session "${sessionTitle}"`, body);
    return this.transporter.sendMail({
      from: `"OpenWebinar Team" <${from}>`,
      to: email,
      subject: `📋 Action needed: "${sessionTitle}" on OpenWebinar`,
      html,
    });
  }

  async sendNewSupportTicket(
    adminEmail: string,
    ticketId: number,
    subject: string,
    message: string,
    userName: string,
    userEmail: string,
  ) {
    const from = process.env.FROM_EMAIL || `noreply@localhost`;
    const adminUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin`;
    const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');

    const body = `
      ${heading('🎫', `New support ticket #${ticketId}`)}
      ${para(`A new support ticket has been submitted on OpenWebinar.`)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
        <tr>
          <td style="background-color:${BRAND.cream};border-left:4px solid ${BRAND.leaf};border-radius:0 10px 10px 0;padding:16px 20px;">
            <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.muted};">Subject</p>
            <p style="margin:0 0 12px;font-size:16px;font-weight:700;color:${BRAND.ink};">${subject}</p>
            <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.muted};">From</p>
            <p style="margin:0;font-size:14px;color:${BRAND.ink};">${userName} &lt;${userEmail}&gt;</p>
          </td>
        </tr>
      </table>
      <div style="background-color:${BRAND.cream};border-left:3px solid ${BRAND.border};border-radius:0 8px 8px 0;padding:16px 20px;margin:0 0 20px;">
        <p style="margin:0;font-size:15px;line-height:1.7;color:${BRAND.ink};">${escaped}</p>
      </div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;">
        <tr>
          <td style="border-radius:10px;background-color:${BRAND.leaf};">
            <a href="${adminUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:${BRAND.white};text-decoration:none;font-family:Georgia,serif;">View in Admin Panel →</a>
          </td>
        </tr>
      </table>
    `;

    const html = baseTemplate(`New support ticket #${ticketId}: ${subject}`, body);
    return this.transporter.sendMail({
      from: `"OpenWebinar Support" <${from}>`,
      to: adminEmail,
      subject: `[Ticket #${ticketId}] ${subject}`,
      html,
    });
  }

  async sendSupportReplyToUser(
    userEmail: string,
    userName: string,
    ticketId: number,
    subject: string,
    replyMessage: string,
  ) {
    const from = process.env.FROM_EMAIL || `noreply@localhost`;
    const firstName = userName.split(' ')[0] || 'there';
    const supportUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/support/${ticketId}`;
    const escaped = replyMessage.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');

    const body = `
      ${heading('💬', `Reply to your support ticket`)}
      ${para(`Hi ${firstName}, the OpenWebinar team has responded to your support ticket.`)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">
        <tr>
          <td style="background-color:${BRAND.cream};border-radius:8px;padding:10px 16px;">
            <p style="margin:0;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.muted};">Ticket #${ticketId} — ${subject}</p>
          </td>
        </tr>
      </table>
      <div style="background-color:${BRAND.cream};border-left:3px solid ${BRAND.leaf};border-radius:0 8px 8px 0;padding:16px 20px;margin:0 0 20px;">
        <p style="margin:0;font-size:15px;line-height:1.7;color:${BRAND.ink};">${escaped}</p>
      </div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;">
        <tr>
          <td style="border-radius:10px;background-color:${BRAND.leaf};">
            <a href="${supportUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:${BRAND.white};text-decoration:none;font-family:Georgia,serif;">View Full Conversation →</a>
          </td>
        </tr>
      </table>
      ${divider()}
      ${smallNote('You can reply directly in the support portal or respond to this email.')}
    `;

    const html = baseTemplate(`Reply to your support ticket: ${subject}`, body);
    return this.transporter.sendMail({
      from: `"OpenWebinar Support" <${from}>`,
      to: userEmail,
      replyTo: from,
      subject: `Re: [Ticket #${ticketId}] ${subject}`,
      html,
    });
  }

  async sendPasswordReset(email: string, name: string | null | undefined, code: string) {
    const from = process.env.FROM_EMAIL || `noreply@localhost`;
    const firstName = name?.split(' ')[0] || 'there';

    const body = `
      ${heading('🔐', 'Reset your password')}
      ${para(`Hi ${firstName}, we received a request to reset the password for your OpenWebinar account.`)}
      ${para(`Enter the code below on the password reset screen:`)}
      ${codeBlock(code)}
      ${para(`This code expires in <strong>30 minutes</strong>.`)}
      ${divider()}
      ${pill('Didn\'t request this?')}
      ${smallNote('If you didn\'t ask to reset your password, your account is safe — you can ignore this email. No changes have been made.')}
    `;

    const html = baseTemplate(`Your OpenWebinar password reset code is ${code}`, body);
    return this.transporter.sendMail({ from, to: email, subject: 'Reset your OpenWebinar password', html });
  }
}
