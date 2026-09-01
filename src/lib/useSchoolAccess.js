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

/**
 * WAIT FOR THE SESSION BEFORE JUDGING ANYONE
 * ------------------------------------------
 * Restoring a Supabase session is asynchronous, so for the first moments of
 * every page load `user` is null on an account that is perfectly signed in.
 * Reading that as "signed out" is wrong, and it showed: the lock screen flashed
 * up on every single load before the session landed and replaced it. Harmless
 * while it was only a flash — not harmless at all now that being signed out
 * sends the student straight to the login page, which would have bounced every
 * signed-in student out of the simulator on arrival.
 *
 * So `authReady` gates the whole thing: until the session question has an
 * answer, the honest state is "still checking", not "denied".
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

export function useSchoolAccess(user, role, authReady = true) {
  const [access, setAccess] = useState({ ...OPEN, checking: true });

  useEffect(() => {
    /* No database to ask, or an administrator — who is exempt from all of it,
       being the only person who can lift any of it. */
    if (!isSupabaseConfigured || role === "admin") {
      setAccess(OPEN);
      return;
    }

    /* The session has not resolved yet. Not signed out — unknown. */
    if (!authReady) {
      setAccess((a) => ({ ...a, checking: true }));
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

        if (subscriptionExpired(endsAt)) {
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
  }, [user?.id, role, authReady]);

  return access;
}

/**
 * Has a subscription end date passed?
 *
 * THROUGH that date, not up to the start of it. An administrator picking
 * 11 August in a date field means "valid for the whole of the 11th" — but a
 * <input type="date"> submits a bare YYYY-MM-DD, which parses to midnight at
 * the START of the day, so the school was locked out for the entire day it had
 * paid for. Rounding up to the end of the day is the only reading that matches
 * what the person choosing the date meant.
 *
 * Done at comparison time rather than when storing, so the dates already in the
 * database behave correctly too, without a migration.
 *
 * UTC deliberately. The server, the database and the browser can each be in a
 * different zone, and a licence that lapses at a different moment depending on
 * who is asking is worse than one that runs a few hours long. Erring long also
 * errs in the school's favour, which is the right direction for the one of the
 * two that is a paying customer.
 */
function subscriptionExpired(endsAt) {
  if (!endsAt) return false; // no end date means no expiry
  const d = new Date(endsAt);
  if (Number.isNaN(d.getTime())) return false;
  const endOfDay = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    23, 59, 59, 999
  );
  return Date.now() > endOfDay;
}
