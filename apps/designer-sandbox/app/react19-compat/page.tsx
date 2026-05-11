'use client';

import React, { useState, useEffect } from 'react';

/* ===================================================================
   React 19 Compatibility Test Harness (SSR-safe entry)
   Uses lazy state initialization to avoid importing canvas libraries
   during SSR — they access localStorage at module evaluation time.
   =================================================================== */

export default function React19CompatPage() {
  const [TestComponent, setTestComponent] = useState<React.ComponentType | null>(null);

  useEffect(() => {
    // Only import on the client, after hydration
    import('./tests').then((mod) => {
      setTestComponent(() => mod.default);
    });
  }, []);

  if (!TestComponent) {
    return <div style={{ padding: 24, fontFamily: 'monospace' }}>Loading test harness...</div>;
  }

  return <TestComponent />;
}
