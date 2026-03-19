'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState, useEffect, useCallback } from 'react';
import ErpDesigner from '@/components/ErpDesigner';
import type { FieldSchemaEntry, BrandConfig } from '@/components/ErpDesigner';
import { getAuthToken } from '@/lib/dev-token';

function DesignerContent() {
  const searchParams = useSearchParams();
  const templateId = searchParams.get('templateId') || undefined;
  const templateName = searchParams.get('templateName') || 'Invoice Template';
  const orgId = searchParams.get('orgId') || undefined;
  const authToken = getAuthToken(searchParams.get('authToken'));
  const autoSaveInterval = searchParams.get('autoSaveInterval')
    ? parseInt(searchParams.get('autoSaveInterval')!, 10)
    : 30000;
  const canPublish = searchParams.get('canPublish') !== 'false';
  const canExportJson = searchParams.get('canExportJson') !== 'false';

  // Support external prop updates via window message or global for host app integration
  const [fieldSchema, setFieldSchema] = useState<FieldSchemaEntry[] | undefined>(undefined);
  const [brandConfig, setBrandConfig] = useState<BrandConfig | undefined>(undefined);

  // Listen for prop update messages from host app (postMessage API)
  const handleMessage = useCallback((event: MessageEvent) => {
    if (event.data?.type === 'erp-designer:update-field-schema') {
      setFieldSchema(event.data.fieldSchema);
    }
    if (event.data?.type === 'erp-designer:update-brand-config') {
      setBrandConfig(event.data.brandConfig);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  return (
    <ErpDesigner
      templateId={templateId}
      templateName={templateName}
      orgId={orgId}
      authToken={authToken}
      apiBase={process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001/api/pdfme"}
      autoSaveInterval={autoSaveInterval}
      canPublish={canPublish}
      canExportJson={canExportJson}
      fieldSchema={fieldSchema}
      brandConfig={brandConfig}
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
