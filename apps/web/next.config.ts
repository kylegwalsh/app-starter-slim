import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Transpile the packages so we can use them in the web app
  transpilePackages: ['@repo/design', '@repo/config'],
  // We validate the types manually, so we'll just skip it here (the trpc routes complain anyways)
  typescript: {
    ignoreBuildErrors: true,
  },
  // Override the webpack config for custom functionality
  webpack: (config: object) => {
    // Ensure the web always grabs the .web.ts files over the normal files (so it can share directories with the backend)
    // @ts-expect-error - Next doesn't type the config correctly
    // eslint-disable-next-line
    config.resolve.extensions.unshift('.web.ts');

    return config;
  },
};

export default nextConfig;
