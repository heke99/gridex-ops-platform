import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ['pdf-lib', 'xlsx'],
  // The resource-bounded document worker is loaded by its filesystem path.
  // Include its runtime dependencies in the two mail-ingestion functions.
  outputFileTracingIncludes: {
    '/api/internal/manual-inbound/cron': [
      './lib/inbound-mail/manualMailDocumentParserWorker.cjs',
      './node_modules/pdf-lib/**/*', './node_modules/@pdf-lib/**/*',
      './node_modules/pako/**/*', './node_modules/tslib/**/*', './node_modules/xlsx/**/*',
    ],
    '/api/webhooks/manual-inbound': [
      './lib/inbound-mail/manualMailDocumentParserWorker.cjs',
      './node_modules/pdf-lib/**/*', './node_modules/@pdf-lib/**/*',
      './node_modules/pako/**/*', './node_modules/tslib/**/*', './node_modules/xlsx/**/*',
    ],
  },
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
      // Independent source/custody copies can each be 10 MiB, plus multipart
      // framing. Each protected intake retains its own per-file bound.
      bodySizeLimit: '25mb',
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
