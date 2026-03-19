'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import TemplateList from '@/components/TemplateList';
import { getAuthToken } from '@/lib/dev-token';

function TemplateListContent() {
  const searchParams = useSearchParams();
  const orgId = searchParams.get('orgId') || undefined;
  const authToken = getAuthToken(searchParams.get('authToken'));

  const handleSelectTemplate = (template: { id: string; name: string }) => {
    const params = new URLSearchParams();
    params.set('templateId', template.id);
    params.set('templateName', template.name);
    if (orgId) params.set('orgId', orgId);
    if (authToken) params.set('authToken', authToken);
    window.location.href = `/?${params.toString()}`;
  };

  return (
    <TemplateList
      apiBase={process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001/api/pdfme"}
      authToken={authToken}
      orgId={orgId}
      onSelectTemplate={handleSelectTemplate}
    />
  );
}

export default function TemplatesPage() {
  return (
    <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center' }}>Loading...</div>}>
      <TemplateListContent />
    </Suspense>
  );
}
