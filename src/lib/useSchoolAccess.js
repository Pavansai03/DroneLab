import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "./supabase.js";

/**
 * MAY THIS PERSON USE THE SIMULATOR?
 * ==================================
 * The simulator is a separate application from the portal and never calls the
 * API — it reads Supabase directly. So every gate the portal enforces was, from
 * here, a suggestion: the portal hiding its "Simulator" button stops nobody who
 * knows the /sim URL, and signing out stopped nothing at all.
 *
 * This is the same set of rules the API applies in /api/me, checked again on
 * this side of the wall. Two implementations of one rule is a thing that
 * drifts, which is why scripts/test-subscription.mjs asserts they agree.
 *
 * WHEN THERE IS NO BACKEND, THERE IS NO GATE
 * ------------------------------------------
 * With Supabase unconfigured the simulator opens to everyone, exactly as it
 * always has. That is not a hole: it is a build with no accounts, no schools
 * and no subscriptions to check — a local checkout, or a copy running at a
 * science fair. A deployment that has been given a database has been given
 * something to enforce.
 *
 * IT FAILS OPEN
 * -------------
 * If the queries error — offline, RLS changed, Supabase down — the student
 * keeps flying. A licence check that empties a classroom because the network
 * hiccuped is worse than one that gives an expired school another lesson.
 */

/** Why someone cannot fly. `null` means they can. */
export const DENIED = {
  SIGNED_OUT: "signed-out",
  NO_SCHOOL: "no-school",
  PENDING: "pending",
  REJECTED: "rejected",
  SCHOOL_INACTIVE: "school-inactive",
  EXPIRED: "expired",
};

const OPEN = { checking: false, reason: null, schoolName: null, endsAt: null };

export function useSchoolAccess(user, role) {
  const [access, setAccess] = useState({ ...OPEN, checking: true });

  useEffect(() => {
    /* No database to ask, or an administrator — who is exempt from all of it,
       being the only person who can lift any of it. */
    if (!isSupabaseConfigured || role === "admin") {
      setAccess(OPEN);
      return;
    }

    if (!user) {
      setAccess({ ...OPEN, reason: DENIED.SIGNED_OUT });
      return;
    }

    let cancelled = false;
    setAccess((a) => ({ ...a, checking: true }));

    (async () => {
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("school_id, status")
          .eq("id", user.id)
          .maybeSingle();
        if (cancelled) return;

        const status = profile?.status ?? "approved";
        if (status === "rejected") return setAccess({ ...OPEN, reason: DENIED.REJECTED });
        if (!profile?.school_id) return setAccess({ ...OPEN, reason: DENIED.NO_SCHOOL });
        if (status === "pending") return setAccess({ ...OPEN, reason: DENIED.PENDING });

        /* Fetched by id rather than trusting the row-level policy to return
           exactly one row: an administrator can see every school, and a bare
           maybeSingle() would error on more than one. */
        const { data: school } = await supabase
          .from("schools")
          .select("name, status, active, subscription_ends_at")
          .eq("id", profile.school_id)
          .maybeSingle();
        if (cancelled) return;

        const schoolName = school?.name ?? null;
        const endsAt = school?.subscription_ends_at ?? null;

        if (!school || school.status !== "approved" || !school.active) {
          return setAccess({ ...OPEN, reason: DENIED.SCHOOL_INACTIVE, schoolName });
        }

        // A missing end date means no expiry — see the API for why null is not "expired".
        if (endsAt && new Date(endsAt).getTime() <= Date.now()) {
          return setAccess({ ...OPEN, reason: DENIED.EXPIRED, schoolName, endsAt });
        }

        setAccess({ ...OPEN, schoolName, endsAt });
      } catch {
        if (!cancelled) setAccess(OPEN);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, role]);

  return access;
}
