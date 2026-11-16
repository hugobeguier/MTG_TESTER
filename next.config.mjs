/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  // Lets a second dev server run beside a production `next start` without overwriting its .next folder (NEXT_DIST_DIR=.next-mp-test).
  distDir: process.env.NEXT_DIST_DIR || ".next"
};

export default nextConfig;
