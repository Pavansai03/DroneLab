# DroneLab Portal — setup

Three panels — student, school, administration — on Next.js, with an Express
API in front of Supabase.

```
portal/    Next.js 14 (App Router)  — the pages      → http://localhost:3000
server/    Express                  — the API        → http://localhost:4000
src/       the existing Vite simulator (unchanged)   → http://localhost:5173
supabase/  schema.sql + portal-schema.sql
```

---

## 1. What to do in the Supabase console

### 1.1 Find your keys

**Project Settings → API.** Three things matter on that page:

| What you see | What it is | Where it goes |
|---|---|---|
| **Project URL** | `https://xxxx.supabase.co`, or on self-hosted Supabase the **Kong gateway URL on port 8000** | `NEXT_PUBLIC_SUPABASE_URL` **and** `SUPABASE_URL` |
| **anon / public** key | Identifies the project. **Public by design** — it ships inside the browser bundle and anyone can read it. It authorises nothing on its own | `NEXT_PUBLIC_SUPABASE_ANON_KEY` **and** `SUPABASE_ANON_KEY` |
| **service_role** key | **Bypasses Row Level Security completely.** Treat it exactly like a database password | `SUPABASE_SERVICE_ROLE_KEY` — `server/.env` only |

> **The one rule that matters.** The service_role key must never appear in
> `portal/`, in `src/`, or in any variable starting `NEXT_PUBLIC_` or `VITE_`.
> Those are compiled into the browser bundle. Anyone who gets that key can read
> and write every row in your database, for every school, ignoring every policy.
> If it ever leaks, rotate it on the same page.
>
> The anon key leaking is *not* an incident. It is meant to be public. Row Level
> Security is the actual boundary.

Use `https://` in production. An `http://` Supabase URL loaded from an `https://`
page is blocked by the browser as mixed content, which presents as "nothing
loads and there is no error".

### 1.2 Run the SQL

**SQL Editor → New query.** Run these in order:

1. `supabase/schema.sql` — profiles, roles, module progress, saved builds
2. `supabase/portal-schema.sql` — schools, the `admin` role, school-scoped RLS
3. `supabase/activity-log.sql` — `record_activity()`, which is the only thing
   that ever writes the flight counts. Without it, "Flights flown" and "Day
   streak" on the student panel, and the flights and crashes columns in the
   teacher dashboard and every exported report, all read zero for everyone.
4. `supabase/per-airframe-progress.sql` — puts the airframe in the key. The
   course is three modules on **each** of the quadcopter, hexacopter and
   octocopter, and until this runs they share one pooled set of three: a
   student who finishes a quadcopter comes back from the portal to find
   Modules 2 and 3 already unlocked and ticked on a hexacopter they have not
   started. It also rebuilds `class_roster` with a per-copter breakdown, and
   fixes a join in that view which was multiplying every student's module
   count by the number of days they had practised.

All four are idempotent; running them twice is harmless.

**Check that the fourth one actually ran.** It is the only step whose absence is
invisible from the outside — the panels keep rendering, the simulator keeps
working, and the school's record quietly stops splitting by aircraft:

```sql
select count(*) as rows_without_an_airframe
from public.module_progress where frame_id is null;
```

That statement failing with *column "frame_id" does not exist* is the answer:
step 4 has not run. A `0` means it has.

The simulator survives either way. The module rail reads the per-airframe
benches in `builds`, never this table, so a hexacopter cannot inherit a
quadcopter's ticks even on a database that is one migration behind — and a
write that Postgres rejects is retried without the column rather than dropped,
with a console error naming the file to run. What you lose until it runs is the
split itself: finished modules come back unlabelled, and the panels and reports
show them as **Not recorded** rather than guessing at an aircraft.

Then confirm RLS is actually on. **Database → Tables**, and check every table
shows *RLS enabled*: `profiles`, `user_roles`, `module_progress`, `builds`,
`schools`, `activity_log`. Self-hosted Supabase creates tables with RLS **off**,
so this is worth looking at rather than assuming — it is the difference between
a secure deployment and a public database.

### 1.3 Auth settings

**Authentication → Providers → Email.** Enable it.

- **Confirm email** *on* for real deployments. *Off* is far easier for a
  classroom trial, where thirty students signing up at once will not all have
  working mail.
- **Authentication → URL Configuration**
  - Site URL: `http://localhost:3000` in development, your portal domain in
    production
  - Redirect URLs: add both the portal origin and the simulator origin

### 1.4 Make yourself the super admin

Sign up through the portal first — the account has to exist. Then in the SQL
editor, with your own email:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'you@example.com'
on conflict (user_id) do update set role = 'admin';
```

This cannot be done from any panel, by design: `user_roles` has no
client-writable policy at all, which is precisely what stops a student promoting
themselves to teacher. After this one grant, every other role change is a
dropdown in the admin panel.

---

## 2. Configure and run

```bash
cp server/.env.example server/.env        # add all three keys
cp portal/.env.example portal/.env.local  # add URL + anon key only
```

```bash
npm install --prefix server && npm run dev --prefix server
```

```bash
npm install --prefix portal && npm run dev --prefix portal
```

Open <http://localhost:3000>. You will be sent to the panel matching your role.

Check the API is alive independently:

```bash
curl http://localhost:4000/health
```

---

## 3. How the pieces fit

```
Browser ──anon key──────────────► Supabase   (RLS decides what you may read)
   │
   └────bearer token────► Express ──service key──► Supabase   (RLS bypassed)
                             ▲
                   admin-only operations
```

**Why Express exists at all.** Supabase can be queried straight from the
browser, and for ordinary reads it is — RLS is a better-tested authorisation
layer than anything hand-written. Express is here for the operations that are
*structurally* impossible from a client:

- **granting a role** — `user_roles` has no client-writable policy, so a student
  cannot promote themselves no matter what they send
- **creating a school** — same reason
- **counting across every school** — exactly what RLS exists to prevent
- **resolving a join code** — a student who has not joined yet cannot see any
  school, so they could never look the code up themselves

Every other route runs as the *caller*, carrying their own token, so the
database applies the same policies it would for a direct query. A bug in a route
handler cannot widen what someone sees.

**Roles are read from the database on every request, never from the JWT.** A
claim baked into a token at sign-in goes stale the moment an admin changes
someone's role; an indexed lookup is always current.

## 4. The three roles

| Role | Sees | Granted by |
|---|---|---|
| `student` | Their own progress, profile, and school membership | Automatic on sign-up |
| `teacher` | Every student **in their own school** — roster, per-module progress, who is stuck | An admin, in the admin panel |
| `admin` | Every school and every account; creates schools, grants roles | SQL, once — then other admins |

A teacher with no school assigned sees a clear message rather than an empty
roster. Assign them under **Administration → People**.

Students join a school by typing its **join code** into their profile page; the
code is shown at the top of the teacher panel.

## 5. Deploying

- **portal** — any Next.js host. Set `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`. These are read at
  **build** time, so a change needs a redeploy, not a restart.
- **server** — any Node host. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, and `CORS_ORIGINS` to your portal's exact origin.
  `CORS_ORIGINS` is an allow-list with no wildcard: these endpoints accept bearer
  tokens, and `*` would let any site on the internet call them with a token it
  had obtained.

The server refuses to boot if any of its three keys is missing, and says which.
That is deliberate — an API that starts happily and then 500s on the first admin
request is much harder to diagnose.

---

## 5.1 When everything stops at once

Two symptoms that look unrelated have one cause, and it is worth recognising
before anyone starts reading the portal's code:

- **Continue with Google disappears.** The button is only ever shown once the
  server has confirmed the provider, so a server that cannot be asked shows
  nothing. It is not a lost build or a missing environment variable.
- **Every sign-in fails**, on every account, with a network error.

Both mean the **Supabase host is not answering**. The login page now says so
outright and names the host, rather than leaving the two to be diagnosed
separately. To confirm from a terminal:

```bash
curl -sS -m 10 -o /dev/null -w '%{http_code}\n' https://YOUR-SUPABASE-DOMAIN/auth/v1/health
```

`000` is not an HTTP status — it means the connection never completed. Then
check the API the same way, at `/health`. If both are dead they are almost
certainly on the same machine, and the machine is the thing to look at.

**One trap specific to this deployment.** A self-hosted Supabase behind Dokploy
is often reached at an `sslip.io` hostname, and that hostname *contains* the
server's IP address — `…-203-0-113-9.sslip.io` resolves to `203.0.113.9` and
nothing else. If the VPS is ever rebuilt or moved and its address changes, that
name points at a stranger's machine for ever. So does any `A` record still
holding the old address. And because `NEXT_PUBLIC_SUPABASE_URL` is compiled into
the portal at build time, fixing it means updating the variable **and
redeploying** — restarting changes nothing.

---

## 6. Google sign-in

Supabase supports Google, GitHub, Microsoft, Apple and others. The portal already
has the code: a **Continue with Google** button appears automatically the moment
the server reports Google as enabled, and stays hidden until then. Nothing needs
rebuilding — the login page asks `/auth/v1/settings` at runtime, which is the
same public endpoint Supabase's own UI reads.

Showing a button for an unconfigured provider is worse than showing none: it
fails with a raw provider error a student cannot act on.

### 6.1 Google Cloud Console

1. <https://console.cloud.google.com> → create or pick a project
2. **APIs & Services → OAuth consent screen** → External → fill in the app name
   and support email. Add your own address under Test users while it is unverified.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorised redirect URI** — this must be your *Supabase* callback, not the
     portal's:
     ```
     https://YOUR-SUPABASE-DOMAIN/auth/v1/callback
     ```
     Google redirects to Supabase, and Supabase then redirects to the portal.
     Pointing this at the portal is the single most common mistake and produces
     `redirect_uri_mismatch`.
4. Copy the **Client ID** and **Client secret**.

### 6.2 Supabase (Dokploy → Environment)

Add these, then **Redeploy**:

```
ENABLE_GOOGLE_SIGNUP=true
GOTRUE_EXTERNAL_GOOGLE_ENABLED=true
GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=<client id>
GOTRUE_EXTERNAL_GOOGLE_SECRET=<client secret>
GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://YOUR-SUPABASE-DOMAIN/auth/v1/callback
```

Also make sure the portal's origin is allowed to be redirected back to:

```
SITE_URL=http://localhost:3000
ADDITIONAL_REDIRECT_URLS=http://localhost:3000/auth/callback,https://your-portal-domain/auth/callback
```

Without that, sign-in succeeds and then bounces to the wrong place.

### 6.3 Check it

```bash
curl -s https://YOUR-SUPABASE-DOMAIN/auth/v1/settings -H "apikey: YOUR-ANON-KEY"
```

`"google": true` in the `external` block means it is on, and the button will be
there on the next page load.

### How the flow works

The browser client uses PKCE, so Google returns a one-time **code**, not a
session. The code verifier lives in an http-only cookie the browser cannot read,
so the exchange happens server-side in `portal/app/auth/callback/route.js`. Doing
it client-side fails with *"both auth code and code verifier should be
non-empty"*, which is not an obvious message to work backwards from.

New Google accounts get a profile automatically: Google supplies `full_name` in
the user metadata, and the `handle_new_user()` trigger from `schema.sql` copies it
across — so a student arrives with their real name already filled in.
