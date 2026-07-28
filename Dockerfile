# =====================================================================
# DroneLab — production image for Dokploy
# =====================================================================
# Build type in Dokploy: Dockerfile. Domain port: 80.
#
# THE IMPORTANT BIT
# -----------------
# Vite substitutes `import.meta.env.VITE_*` while `vite build` runs, then throws
# the environment away. The values are baked into the JS bundle.
#
# That means Dokploy's *runtime* environment variables have NO effect on this
# image — the bundle was already compiled. The Supabase URL and anon key must be
# supplied as BUILD ARGUMENTS, under
#     Advanced -> Build Time Arguments (or "Build Args")
# not under Environment. Getting this wrong produces a bundle where
# VITE_SUPABASE_URL is `undefined`, and the only symptom is that nothing saves.
#
# Leaving them unset is fine and supported: the app then runs entirely locally
# with the cloud layer switched off.
# =====================================================================

FROM node:20-alpine AS build
WORKDIR /app

# Dependencies first, so a source-only change reuses the cached layer.
COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

# Fail loudly rather than shipping a half-configured bundle.
RUN if [ -n "$VITE_SUPABASE_URL" ] && [ -z "$VITE_SUPABASE_ANON_KEY" ]; then \
      echo "ERROR: VITE_SUPABASE_URL is set but VITE_SUPABASE_ANON_KEY is not." >&2; \
      exit 1; \
    fi \
 && npm run build

# ---------------------------------------------------------------- serve
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q --spider http://localhost/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
