/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /* The simulator is a static build sitting in public/sim, put there by
     scripts/build-merged.mjs. Files under public/ are served at their exact
     path, so /sim/index.html works and a bare /sim does not — it matches no
     Next route and no file, and 404s. These rewrites make the directory behave
     the way anyone typing the URL expects. */
  async rewrites() {
    return [
      { source: "/sim", destination: "/sim/index.html" },
      { source: "/sim/", destination: "/sim/index.html" },
    ];
  },
};

export default nextConfig;
