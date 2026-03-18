'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import ErpDesigner from '@/components/ErpDesigner';

function DesignerContent() {
  const searchParams = useSearchParams();
  const templateId = searchParams.get('templateId') || undefined;
  const templateName = searchParams.get('templateName') || 'Invoice Template';
  const orgId = searchParams.get('orgId') || undefined;
  const authToken = searchParams.get('authToken') || undefined;
  const autoSaveInterval = searchParams.get('autoSaveInterval')
    ? parseInt(searchParams.get('autoSaveInterval')!, 10)
    : 30000;

  return (
    <ErpDesigner
      templateId={templateId}
      templateName={templateName}
      orgId={orgId}
      authToken={authToken}
      apiBase="http://localhost:3000/api/pdfme"
      autoSaveInterval={autoSaveInterval}
    />
  );
}

export default function DesignerPage() {
  return (
    <Suspense fallback={<div>Loading designer...</div>}>
      <DesignerContent />
    </Suspense>
  );
}
