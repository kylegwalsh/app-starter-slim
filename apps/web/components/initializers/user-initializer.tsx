'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { storage } from '@/core';
import { useCurrentUser } from '@/hooks';

/** Watches user changes and performs tasks */
export const UserInitializer = () => {
  const { isLoading, isLoggedIn } = useCurrentUser();
  const queryClient = useQueryClient();

  // Once the user logs in, store something indicating that they had a session at some point (used to detect session expiration)
  useEffect(() => {
    if (isLoggedIn) {
      // We track whether a previous session existed in order to clear some data below
      storage.set('sessionExisted', 'true');
    }
  }, [isLoggedIn]);

  // If the user signs out (or their session expires), handle some additional logic to purge their data
  useEffect(() => {
    /** Check whether they previously had a session and whether we already ran this logic */
    const previousSessionExisted = !!storage.get('sessionExisted');

    // Verify all conditions are met that indicate a session expired
    if (!isLoading && !isLoggedIn && previousSessionExisted) {
      console.log('[UserInitializer] User logged out... clearing data');

      // Mark their session as having been cleared
      storage.delete('sessionExisted');

      // Reset all queries
      queryClient.clear();
    }
  }, [isLoading, isLoggedIn, queryClient]);

  // Don't render any UI elements
  return null;
};
