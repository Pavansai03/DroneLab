import { Router } from "express";
import { route } from "../auth.js";
import { adminClient } from "../supabase.js";

/**
 * SCHOOL APPLICATION ROUTES
 * =========================
 * A school registers itself and then waits for an administrator.
 *
 * The write goes through the SERVICE ROLE, and it has to: `schools` has no
 * client-writable policy, which is exactly what stops an applicant inserting a
 * row with `status = 'approved'` and admitting themselves. The status is set
 * here, in code the applicant cannot influence, and every field they can
 * influence is treated as untrusted text.
 */

const router = Router();

/** Apply. One pending application per account. */
router.post(
  "/apply",
  route(async (req, res) => {
    const { user } = req.auth;
    const name = String(req.body?.name ?? "").trim();
    const phone = String(req.body?.phone ?? "").trim();
    const region = String(req.body?.region ?? "").trim() || null;

    if (name.length < 2) return res.status(400).json({ error: "Enter the school's name." });
    if (name.length > 160) return res.status(400).json({ error: "That name is too long." });

    const db = adminClient();

    /* One application per account. Without this, a refresh or a double-click
       leaves two pending rows for the same school and an administrator has to
       work out which is real. */
    const { data: existing } = await db
      .from("schools")
      .select("id, name, status")
      .eq("owner_id", user.id)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({
        error:
          existing.status === "rejected"
            ? `A previous application for ${existing.name} was not approved.`
            : `You already have an application for ${existing.name}.`,
        school: existing,
      });
    }

    const { data, error } = await db
      .from("schools")
      .insert({
        name,
        phone: phone || null,
        region,
        contact_email: user.email,
        owner_id: user.id,
        status: "pending",
        join_code: null, // does not exist until approval
        active: true,
      })
      .select("id, name, status, applied_at")
      .maybeSingle();

    if (error) return res.status(400).json({ error: error.message });

    /* The applicant becomes a school account — unless they are already an
       administrator.
       Upserting unconditionally meant an admin who tried the registration flow
       DEMOTED THEMSELVES to 'school' and lost the panel that approves schools.
       On a deployment with one administrator, that locks approvals out entirely
       and the only way back is editing the database by hand. Testing your own
       sign-up flow should never be able to do that. */
    if (req.auth.role !== "admin") {
      await db.from("user_roles").upsert({ user_id: user.id, role: "school" }, { onConflict: "user_id" });
    }

    res.status(201).json({ application: data });
  })
);

/**
 * The applicant's own view of their application.
 *
 * Drives the "approval pending" screen and, once decided, tells them what
 * happened — including the join code, so an approved school is not dependent on
 * an email that may never have been sent.
 */
router.get(
  "/application",
  route(async (req, res) => {
    const { data } = await adminClient()
      .from("schools")
      .select("id, name, status, join_code, applied_at, decided_at, decision_note, contact_email, phone, region")
      .eq("owner_id", req.auth.user.id)
      .maybeSingle();

    res.json({ application: data ?? null });
  })
);

export default router;
