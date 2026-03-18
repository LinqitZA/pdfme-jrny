'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import SignatureManager from '@/components/SignatureManager';

function SignatureContent() {
  const searchParams = useSearchParams();
  const orgId = searchParams.get('orgId') || 'default';
  const authToken = searchParams.get('authToken') || undefined;

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ marginBottom: 20 }}>Signature Manager</h1>
      <SignatureManager
        apiBase={process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001/api/pdfme"}
        authToken={authToken}
        orgId={orgId}
        onSave={(result) => console.log('Signature saved:', result)}
        onClear={() => console.log('Signature cleared')}
      />
    </div>
  );
}

export default function SignaturesPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SignatureContent />
    </Suspense>
  );
}
