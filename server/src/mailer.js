import nodemailer from "nodemailer";

/**
 * OUTBOUND EMAIL
 * ==============
 * One message matters here: the note that tells a school it has been approved
 * and carries its join code.
 *
 * DEGRADES INSTEAD OF FAILING
 * ---------------------------
 * SMTP is optional. If it is not configured the message is written to the log
 * in full, including the join code, and the caller is told it was not sent.
 * That is deliberate: approving a school is an administrative decision that
 * must succeed whether or not a mail server happens to be reachable. Coupling
 * the two means one SMTP outage blocks every approval, and the administrator is
 * left with a school stuck in limbo and no idea why.
 *
 * The panel shows whether the mail went out, so the code can be passed on by
 * hand when it did not.
 */

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT ?? 587);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const from = process.env.SMTP_FROM || user || "dronelab@localhost";

export const mailConfigured = Boolean(host && user && pass);

let transport = null;
function getTransport() {
  if (!mailConfigured) return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host,
      port,
      // 465 is implicit TLS; everything else starts plain and upgrades
      secure: port === 465,
      auth: { user, pass },
    });
  }
  return transport;
}

/**
 * Send one message.
 *
 * Never throws. Returns `{ sent, reason }` so a caller can report what happened
 * without having to decide whether an email failure should undo its own work.
 */
export async function sendMail({ to, subject, text, html }) {
  if (!mailConfigured) {
    console.warn(
      `[mail] SMTP not configured — message NOT sent.\n` +
        `       to: ${to}\n  subject: ${subject}\n\n${text}\n`
    );
    return { sent: false, reason: "SMTP is not configured on the server." };
  }
  try {
    await getTransport().sendMail({ from, to, subject, text, html });
    return { sent: true };
  } catch (err) {
    /* Log the whole message, so the join code is recoverable from the log if
       the only copy was in an email that never left. */
    console.error(
      `[mail] send failed: ${err.message}\n       to: ${to}\n  subject: ${subject}\n\n${text}\n`
    );
    return { sent: false, reason: err.message };
  }
}

/* ------------------------------------------------------------- templates */

/** The approval note. Its whole job is to carry the join code, legibly. */
export function schoolApprovedEmail({ schoolName, joinCode, portalUrl }) {
  const subject = `${schoolName} is approved on DroneLab — your join code is ${joinCode}`;

  const text = [
    `${schoolName} has been approved on DroneLab.`,
    ``,
    `YOUR JOIN CODE:  ${joinCode}`,
    ``,
    `Give this code to your students. They will each:`,
    `  1. create an account at ${portalUrl}`,
    `  2. enter this code once, when asked`,
    `  3. get access to the drone simulator`,
    ``,
    `Until a student enters the code they can sign in, but the simulator stays`,
    `locked — so the code is what ties them to your school and puts their`,
    `progress on your dashboard.`,
    ``,
    `Treat it like a door key: anyone who has it can join your school and appear`,
    `on your roster. Circulate it within the school only.`,
    ``,
    `Sign in at ${portalUrl} to see your students as they join.`,
  ].join("\n");

  const html = `
<div style="font-family:system-ui,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#212121">
  <div style="background:linear-gradient(135deg,#2e7d32,#1565c0);padding:28px 30px;border-radius:12px 12px 0 0">
    <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:.04em">DRONELAB</div>
    <div style="color:rgba(255,255,255,.9);font-size:15px;margin-top:6px">Your school has been approved</div>
  </div>
  <div style="border:1px solid #ddd;border-top:0;border-radius:0 0 12px 12px;padding:28px 30px;background:#fff">
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6">
      <strong>${schoolName}</strong> has been approved on DroneLab.
    </p>

    <div style="background:#f1f8f2;border:1px solid #2e7d32;border-radius:10px;padding:18px;text-align:center;margin:0 0 22px">
      <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#2e7d32;font-weight:700">Your join code</div>
      <div style="font-family:ui-monospace,monospace;font-size:30px;font-weight:800;letter-spacing:.08em;color:#1565c0;margin-top:8px">${joinCode}</div>
    </div>

    <p style="margin:0 0 10px;font-size:15px;line-height:1.6"><strong>Circulate this code to your students.</strong> Each of them will:</p>
    <ol style="margin:0 0 20px;padding-left:20px;font-size:15px;line-height:1.9">
      <li>create an account at <a href="${portalUrl}" style="color:#1565c0">${portalUrl}</a></li>
      <li>enter this code once, when asked</li>
      <li>get access to the drone simulator</li>
    </ol>

    <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#555">
      Until a student enters the code they can sign in, but the simulator stays locked — the code is
      what ties them to your school and puts their progress on your dashboard.
    </p>
    <p style="margin:0;font-size:14px;line-height:1.6;color:#8a5a00;background:#fff8e1;border:1px solid #ffcc80;border-radius:8px;padding:12px">
      Treat it like a door key: anyone who has it can join your school and appear on your roster.
      Circulate it within the school only.
    </p>
  </div>
</div>`.trim();

  return { subject, text, html };
}

/** The rejection note. Short, and says whether it can be revisited. */
export function schoolRejectedEmail({ schoolName, reason, portalUrl }) {
  const subject = `Your DroneLab application for ${schoolName}`;
  const text = [
    `Thank you for applying to DroneLab with ${schoolName}.`,
    ``,
    `We are not able to approve the application at this time.`,
    reason ? `\nReason given: ${reason}` : ``,
    ``,
    `If you think this is a mistake, or circumstances change, reply to this`,
    `message and we will take another look.`,
    ``,
    portalUrl,
  ].join("\n");

  const html = `
<div style="font-family:system-ui,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#212121">
  <div style="border:1px solid #ddd;border-radius:12px;padding:28px 30px;background:#fff">
    <div style="font-size:18px;font-weight:800;margin-bottom:14px">DroneLab</div>
    <p style="font-size:15px;line-height:1.6;margin:0 0 14px">
      Thank you for applying with <strong>${schoolName}</strong>. We are not able to approve the
      application at this time.
    </p>
    ${reason ? `<p style="font-size:15px;line-height:1.6;margin:0 0 14px"><strong>Reason:</strong> ${reason}</p>` : ""}
    <p style="font-size:14px;line-height:1.6;color:#555;margin:0">
      If you think this is a mistake, or circumstances change, reply to this message and we will
      take another look.
    </p>
  </div>
</div>`.trim();

  return { subject, text, html };
}
