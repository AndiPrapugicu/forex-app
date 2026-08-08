import type { Metadata, Viewport } from 'next';
import { Sidebar } from '@/components/Sidebar';
import './globals.css';

export const metadata: Metadata = {
  title: 'FX Intel — Trading Scorecard',
  description:
    'Explainable bullish/bearish scoring across currencies, pairs, metals and oil, built from economic releases, COT positioning and corroborated news flow.',
};

export const viewport: Viewport = {
  themeColor: '#0a0d14',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        {/* Column on small screens (nav collapses to a top bar), row from lg up. */}
        <div className="flex min-h-screen flex-col lg:flex-row">
          <Sidebar />
          {/* min-w-0 is load-bearing: without it the wide setups matrix forces
              the flex row to overflow instead of scrolling inside its own panel. */}
          <div className="grid-bg min-w-0 flex-1">{children}</div>
        </div>
      </body>
    </html>
  );
}
