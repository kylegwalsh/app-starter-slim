import { db } from '@/db';

import { t } from './trpc/init';
import { protectedProcedure, publicProcedure } from './trpc/procedures';

/** The actual router used to handle all tRPC traffic */
export const router = t.router({
  test: publicProcedure.query(async () => {
    const count = await db.user.count();
    return count;
  }),
});

/**
 * The type of our backend router
 *
 * Note: This is shared with the frontend by generating the types
 * and configuring our tsconfig intelligently
 */
export type AppRouter = typeof router;
