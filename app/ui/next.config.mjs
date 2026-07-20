/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Datasets/thumbnails can be large; allow big server action bodies.
  experimental: { serverActions: { bodySizeLimit: "50mb" } },
};
export default nextConfig;
