import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'pdfme ERP Designer',
  description: 'WYSIWYG template designer for ERP documents',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  );
}
