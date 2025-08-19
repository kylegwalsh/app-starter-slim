'use client';

import { trpc } from '@/core';

/** Our main dashboard page */
export default function DashboardPage() {
  const { data, isLoading } = trpc.test.useQuery();

  return <></>;
}
