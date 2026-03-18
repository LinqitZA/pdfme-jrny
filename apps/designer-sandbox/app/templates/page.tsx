'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import TemplateList from '@/components/TemplateList';

function TemplateListContent() {
  const searchParams = useSearchParams();
  const orgId = searchParams.get('orgId') || undefined;
  const authToken = searchParams.get('authToken') || undefined;

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
      apiBase="http://localhost:3000/api/pdfme"
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
