import type { ReactNode } from 'react';
import { RootProvider } from 'fumadocs-ui/provider/next';
import './globals.css';

export const metadata = {
  title: 'System Design Practice',
  description: 'Tổng hợp các bài thực hành System Design theo chuẩn blueprint 17 bước',
  icons: {
    icon: [
      { url: '/favicon.ico?v=2', sizes: '32x32' },
      { url: '/favicon.svg?v=2', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.ico?v=2',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <RootProvider search={{ options: { type: 'static' } }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
