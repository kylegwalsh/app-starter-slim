import { api } from './api';

// Our main web app
export const site = new sst.aws.Nextjs('web', {
  link: [api],
  path: 'apps/web',
  buildCommand: 'pnpm dlx open-next build',
  environment: {
    NEXT_PUBLIC_STAGE: $app.stage,
    NEXT_PUBLIC_API_URL: api.url,
  },
});
