import type { Metadata, Viewport } from 'next';
import { Sidebar } from '@/components/Sidebar';
import './globals.css';

export const metadata: Metadata = {
  title: 'FX Intel — Trading Scorecard',
  description:
    'Explainable bullish/bearish scoring across currencies, pairs, metals and oil, built from economic releases, COT positioning and corroborated news flow.',
};

export const viewport: Viewport = {
  themeColor: '#111214',
  // Lets content reach under the iPhone home indicator; the tab bar pads itself.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        {/*
          Column on small screens (top bar + bottom tab bar), row from lg up.
          `dvh` rather than `vh`: on mobile Safari 100vh includes the collapsing
          address bar, so a full-height layout overflowed by its height.
        */}
        <div className="flex min-h-dvh flex-col lg:flex-row">
          <Sidebar />
          {/* min-w-0 is load-bearing: without it the wide setups matrix forces
              the flex row to overflow instead of scrolling inside its own panel.
              The bottom padding clears the mobile tab bar. */}
          <div className="grid-bg min-w-0 flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
