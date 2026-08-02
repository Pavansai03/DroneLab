/**
 * Where the flight simulator lives.
 *
 * It is a separate application on its own origin — the Vite app in development,
 * wherever it is deployed in production — so the portal cannot route to it and
 * has to be told. Configurable rather than hard-coded, because the two are
 * deployed independently and will not always share a host.
 */
export const simulatorUrl = () =>
  process.env.NEXT_PUBLIC_SIMULATOR_URL || "http://localhost:5173";
