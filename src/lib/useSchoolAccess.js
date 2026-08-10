import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "./supabase.js";

/**
 * IS THIS ACCOUNT'S SCHOOL STILL SUBSCRIBED?
 * ==========================================
 * The simulator is a separate application from the portal and does not talk to
 * the API at all — it reads Supabase directly. So the portal refusing to open
 * it is a courtesy, not a control: anyone who knows the /sim URL walks straight
 * past that. The check has to live here too.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * Signed out, it does nothing. The simulator has always worked with no account
 * and no backend — that is a deliberate property of the product, not an
 * oversight, and taking it away is a decision about what DroneLab is rather
 * than a subscription check. So this locks members of an expired school; it
 * does not turn the simulator into something that requires a login.
 *
 * It also fails OPEN. If the query errors — offline, RLS changed, Supabase
 * down — the student keeps flying. A licence check that locks a classroom out
 * because the network hiccuped is worse than one that occasionally lets an
 * expired school have another lesson.
 */
export function useSchoolAccess(user, role) {
  const [access, setAccess] = useState({
    checking: true,
    locked: false,
    schoolName: null,
    endsAt: null,
  });

  useEffect(() => {
    /* Nothing to check: no backend, nobody signed in, or an administrator —
       who is exempt, because they are the only person who can lift this. */
    if (!isSupabaseConfigured || !user || role === "admin") {
      setAccess({ checking: false, locked: false, schoolName: null, endsAt: null });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("school_id")
          .eq("id", user.id)
          .maybeSingle();

        if (cancelled) return;
        if (!profile?.school_id) {
          // Not in a school yet — nothing to expire.
          setAccess({ checking: false, locked: false, schoolName: null, endsAt: null });
          return;
        }

        /* Fetched by id rather than relying on the row-level policy to return
           exactly one: an administrator can see every school, and a bare
           maybeSingle() would error on more than one row. */
        const { data: school } = await supabase
          .from("schools")
          .select("name, subscription_ends_at")
          .eq("id", profile.school_id)
          .maybeSingle();

        if (cancelled) return;

        const endsAt = school?.subscription_ends_at ?? null;
        // No end date means no expiry — see the API for why null is not "expired".
        const locked = Boolean(endsAt && new Date(endsAt).getTime() <= Date.now());

        setAccess({ checking: false, locked, schoolName: school?.name ?? null, endsAt });
      } catch {
        if (!cancelled) {
          setAccess({ checking: false, locked: false, schoolName: null, endsAt: null });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, role]);

  return access;
}
