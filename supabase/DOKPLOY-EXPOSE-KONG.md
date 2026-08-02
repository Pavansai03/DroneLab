# Exposing Supabase (Kong) through Dokploy's Traefik

## The symptom

Every request to the Supabase domain returns Traefik's own `404 page not found`,
including the root path, and the TLS certificate is `TRAEFIK DEFAULT CERT`.

## What that actually means

There is **no Traefik router for that hostname**. Traefik answers unknown hosts
with its default certificate and a 404. The certificate is not the problem — it
is downstream of the problem. Traefik only requests a Let's Encrypt certificate
for hostnames it has been told to route, so no route means no certificate,
always.

Setting `SUPABASE_PUBLIC_URL` in the stack's environment does not create a route.
That variable tells Supabase what to call itself in generated links; it does not
tell the reverse proxy anything.

## The fix

Dokploy versions before 0.7.0 have no Domains tab for Compose stacks, so the
router has to be declared in the compose file with Traefik labels.

In Dokploy, open the Supabase stack and find the compose editor (usually under
**General**, sometimes **Advanced**). Find the `kong` service and add a `labels:`
block and the `dokploy-network`:

```yaml
services:
  kong:
    # ...everything already there stays as it is...
    networks:
      - default
      - dokploy-network
    labels:
      - traefik.enable=true
      - traefik.docker.network=dokploy-network
      - traefik.http.routers.supabase-kong.rule=Host(`YOUR-DOMAIN-HERE`)
      - traefik.http.routers.supabase-kong.entrypoints=websecure
      - traefik.http.routers.supabase-kong.tls=true
      - traefik.http.routers.supabase-kong.tls.certresolver=letsencrypt
      - traefik.http.services.supabase-kong.loadbalancer.server.port=8000
```

And at the **bottom of the file**, at the top level (not indented under a
service), declare the network as external so Traefik can reach into it:

```yaml
networks:
  dokploy-network:
    external: true
```

Replace `YOUR-DOMAIN-HERE` with the hostname, no scheme and no trailing slash:

```
dronelab-supabase-864afd-187-127-118-220.sslip.io
```

Then **Redeploy** the stack.

### Notes on the details

- `letsencrypt` is the resolver Dokploy configures in its `traefik.yml`. The name
  must match exactly or Traefik silently keeps serving the default certificate.
- `supabase-kong` is just a router name. It must be unique across everything
  Traefik is managing on that host.
- Port `8000` is Kong's port *inside* the container network. It does not need to
  be published to the host, and it is better that it is not — Traefik reaches it
  over `dokploy-network`, so the only thing exposed publicly is 80 and 443.
- `sslip.io` resolves publicly and port 80 is open on this host, so the HTTP-01
  challenge will succeed.

## Verifying

From the repo root:

```bash
node supabase/check-connection.mjs
```

Or directly — this should return JSON, not an HTML 404:

```bash
curl https://YOUR-DOMAIN-HERE/auth/v1/settings
```

Once it works, delete `ALLOW_SELF_SIGNED_TLS=true` from `server/.env`. It exists
only to tolerate the placeholder certificate and should not outlive it.

## If you would rather not edit the compose file

Upgrading Dokploy to 0.7.0 or later adds a **Domains** tab for Compose stacks
that does all of the above through the UI: Host, Service Name (`kong`),
Container Port (`8000`), HTTPS on, Certificate = Let's Encrypt.
