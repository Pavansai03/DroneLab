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

Both are idempotent; running them twice is harmless.

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
