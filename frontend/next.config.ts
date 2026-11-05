import type { NextConfig } from "next";

// On Vercel, vercel.json sends /api/* to the Python service before Next.js sees it.
// Locally, Next.js forwards those requests to the API server started with uvicorn.
const apiTarget =
  process.env.API_PROXY_TARGET ??
  (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8000" : null);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return apiTarget ? [{ source: "/api/:path*", destination: `${apiTarget}/api/:path*` }] : [];
  },
};

export default nextConfig;
