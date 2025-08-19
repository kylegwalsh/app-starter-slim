/// <reference path="./.sst/platform/config.d.ts" />

// The config that manages our SST application / deployments
export default $config({
  app(input) {
    return {
      name: 'my-app',
      removal: input?.stage === 'prod' ? 'retain' : 'remove',
      protect: ['prod'].includes(input?.stage),
      home: 'aws',
    };
  },
  async run() {
    // ---------- LOCAL DB ----------
    // Start DB connection when running the dev command
    new sst.x.DevCommand('DB', {
      dev: {
        autostart: true,
        command: 'pnpm backend db:start',
      },
    });

    // ---------- SECRETS ----------
    // Import secrets first since other stacks might need them
    const secrets = await import('./infra/secrets');

    // ---------- FUNCTION DEFAULTS ----------
    // Apply default settings to all functions
    $transform(sst.aws.Function, (args) => {
      // ---------- SECRETS ----------
      // Link the secrets to every method
      // eslint-disable-next-line unicorn/prefer-spread
      args.link = ([] as unknown[]).concat((args.link as unknown[]) || [], Object.values(secrets));

      // ---------- PERMISSIONS ----------
      // Add permissions for the Bedrock AI API
      args.permissions ??= [];
      if (Array.isArray(args.permissions)) {
        args.permissions.push({
          effect: 'allow',
          actions: ['bedrock:*'],
          resources: ['*'],
        });
      }

      // ---------- ENVIRONMENT ----------
      // Add any environment variables
      args.environment = {
        // Add this so that AWS will re-use TCP connections instead of re-connecting every time
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      };
      // Copy prisma files over to our functions (not needed for local development)
      args.copyFiles ??= $dev
        ? []
        : [
            {
              from: 'node_modules/.prisma',
              to: 'node_modules/.prisma',
            },
            {
              from: 'node_modules/@prisma/client',
              to: 'node_modules/@prisma/client',
            },
            {
              from: 'node_modules/prisma',
              to: 'node_modules/prisma',
            },
          ];
      // Set any default node options
      args.nodejs ??= $dev
        ? {
            // Exclude prisma from our local functions
            install: ['@prisma/client'],
          }
        : {
            // Generate source maps for our deployments so we can upload them for error tracking
            sourcemap: true,
            // Copy the necessary prisma files over to our functions
            esbuild: {
              platform: 'node',
              external: ['@prisma/client'],
            },
          };

      // ---------- RUNTIME ----------
      // Select the architecture and runtime
      args.architecture ??= 'arm64';
      args.runtime ??= 'nodejs20.x';
    });

    // ---------- MAIN ----------
    // Import primary application stacks
    await import('./infra/api');
    await import('./infra/web');
    await import('./infra/agent');
  },
});
