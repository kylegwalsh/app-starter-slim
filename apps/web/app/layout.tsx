import '@repo/design/globals.css';

import { config } from '@repo/config';
import { Toaster } from '@repo/design';
import Script from 'next/script';

import { ErrorBoundary, Providers, UserInitializer } from '@/components';

/** The default metadata for the app */
export const metadata = {
  title: 'My App',
  description: 'My App',
};

/** Our primary layout wrapping the entire app */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-svh flex-col antialiased">
        <ErrorBoundary>
          <Providers>
            {children}
            <UserInitializer />
            <Toaster />
          </Providers>
        </ErrorBoundary>
      </body>
    </html>
  );
}
