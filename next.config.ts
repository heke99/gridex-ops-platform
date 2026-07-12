import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
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
