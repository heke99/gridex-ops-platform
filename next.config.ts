import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Keep the established Turbopack development server explicit when the
  // production-only webpack chunk hook below is present (Next 16).
  turbopack: {},
  webpack(config, { isServer, dev }) {
    // Next16.3's measured client navigation-cache modules otherwise share one
    // oversized router chunk. Cache that cohesive module group separately;
    // retain all upstream framework groups and never alter server/dev builds.
    if (!isServer && !dev && config.optimization?.splitChunks) {
      const splitChunks = config.optimization.splitChunks
      config.optimization.splitChunks = {
        ...splitChunks,
        cacheGroups: {
          ...splitChunks.cacheGroups,
          gridexNavigationCache: {
            test: /[\\/]next[\\/]dist[\\/]client[\\/]components[\\/]segment-cache[\\/]/,
            name: 'gridex-navigation-cache',
            chunks: 'all',
            priority: 50,
            enforce: true,
            reuseExistingChunk: true,
          },
        },
      }
    }
    return config
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
    cpus: 1,
    memoryBasedWorkersCount: false,
    parallelServerCompiles: false,
    parallelServerBuildTraces: false,
    webpackBuildWorker: true,
    webpackMemoryOptimizations: true,
  },
  async redirects() {
    return [
      {
        source: '/admin/admin/:path*',
        destination: '/admin/:path*',
        permanent: false,
      },
      {
        source: '/admin/control-tower',
        destination: '/admin/controltower',
        permanent: false,
      },
      {
        source: '/admin/ediel/controltower',
        destination: '/admin/ediel/control-tower',
        permanent: false,
      },
    ]
  },
};

export default nextConfig;
