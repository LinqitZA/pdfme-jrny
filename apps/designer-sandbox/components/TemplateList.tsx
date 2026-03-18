'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';

interface Template {
  id: string;
  name: string;
  type: string;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  lockedBy?: string | null;
  lockedAt?: string | null;
}

interface PaginationInfo {
  total: number;
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}

interface TemplateListProps {
  apiBase?: string;
  authToken?: string;
  orgId?: string;
  onSelectTemplate?: (template: Template) => void;
}

export default function TemplateList({
  apiBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3001/api/pdfme',
  authToken,
  orgId,
  onSelectTemplate,
}: TemplateListProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Restore filters from sessionStorage for within-session persistence
  const [typeFilter, setTypeFilter] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('tpl_filter_type') || '';
    }
    return '';
  });
  const [statusFilter, setStatusFilter] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('tpl_filter_status') || '';
    }
    return '';
  });
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('tpl_filter_search') || '';
    }
    return '';
  });
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const archivingRef = useRef<string | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    return headers;
  }, [authToken]);

  // Fetch available types from the database
  const fetchTypes = useCallback(async () => {
    setLoadingTypes(true);
    try {
      const params = new URLSearchParams();
      if (orgId) params.set('orgId', orgId);

      const response = await fetch(`${apiBase}/templates/types?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch types: ${response.status}`);
      }
      const data = await response.json();
      setAvailableTypes(data.types || []);
    } catch (err) {
      console.error('Failed to load template types:', err);
      setAvailableTypes([]);
    } finally {
      setLoadingTypes(false);
    }
  }, [apiBase, orgId, getAuthHeaders]);

  // Fetch templates from the API
  const fetchTemplates = useCallback(async (appendCursor?: string | null) => {
    if (appendCursor) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const params = new URLSearchParams();
      if (orgId) params.set('orgId', orgId);
      params.set('limit', '20');
      if (typeFilter) params.set('type', typeFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      if (appendCursor) params.set('cursor', appendCursor);

      const response = await fetch(`${apiBase}/templates?${params.toString()}`, {
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
        throw new Error(errBody.message || `HTTP ${response.status}`);
      }

      const result = await response.json();

      if (appendCursor) {
        setTemplates(prev => [...prev, ...result.data]);
      } else {
        setTemplates(result.data);
      }
      setPagination(result.pagination);
      setCursor(result.pagination.nextCursor);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [apiBase, orgId, typeFilter, statusFilter, searchQuery, getAuthHeaders]);

  // Load types on mount
  useEffect(() => {
    fetchTypes();
  }, [fetchTypes]);

  // Load templates on mount and when filter changes
  useEffect(() => {
    setCursor(null);
    fetchTemplates(null);
  }, [fetchTemplates]);

  const handleArchive = useCallback(async (templateId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger card click
    if (archivingRef.current === templateId) return; // Prevent double-click
    archivingRef.current = templateId;
    setArchivingId(templateId);

    try {
      const response = await fetch(`${apiBase}/templates/${templateId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });

      if (response.ok) {
        // Remove from local list
        setTemplates(prev => prev.filter(t => t.id !== templateId));
        if (pagination) {
          setPagination(prev => prev ? { ...prev, total: prev.total - 1 } : prev);
        }
      } else {
        const errBody = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
        setError(errBody.message || `Failed to archive template: ${response.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive template');
    } finally {
      archivingRef.current = null;
      setArchivingId(null);
    }
  }, [apiBase, getAuthHeaders, pagination]);

  const handleLoadMore = () => {
    if (cursor && !loadingMore) {
      fetchTemplates(cursor);
    }
  };

  const handleTypeChange = (newType: string) => {
    setTypeFilter(newType);
    setCursor(null);
    sessionStorage.setItem('tpl_filter_type', newType);
  };

  const handleStatusChange = (newStatus: string) => {
    setStatusFilter(newStatus);
    setCursor(null);
    sessionStorage.setItem('tpl_filter_status', newStatus);
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCursor(null);
    sessionStorage.setItem('tpl_filter_search', value);
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-ZA', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const formatTypeName = (type: string) => {
    return type
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  };

  const LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes - matches backend

  const isLockActive = (template: Template): boolean => {
    if (!template.lockedBy || !template.lockedAt) return false;
    const expiresAt = new Date(new Date(template.lockedAt).getTime() + LOCK_DURATION_MS);
    return new Date() < expiresAt;
  };

  const getLockExpiresAt = (template: Template): string | null => {
    if (!template.lockedAt) return null;
    return new Date(new Date(template.lockedAt).getTime() + LOCK_DURATION_MS).toISOString();
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'published': return { bg: '#dcfce7', color: '#166534', border: '#86efac' };
      case 'draft': return { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' };
      case 'archived': return { bg: '#f3f4f6', color: '#6b7280', border: '#d1d5db' };
      default: return { bg: '#f3f4f6', color: '#6b7280', border: '#d1d5db' };
    }
  };

  return (
    <div data-testid="template-list-container" style={{ fontFamily: 'Inter, system-ui, sans-serif', padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 data-testid="template-list-title" style={{ fontSize: '24px', fontWeight: 700, color: '#1e293b', margin: 0 }}>
            Template Management
          </h1>
          {pagination && (
            <p data-testid="template-count" style={{ fontSize: '14px', color: '#64748b', marginTop: '4px' }}>
              {pagination.total} template{pagination.total !== 1 ? 's' : ''} found
              {typeFilter && ` (type: ${formatTypeName(typeFilter)})`}
              {statusFilter && ` (status: ${statusFilter})`}
            </p>
          )}
        </div>
      </div>

      {/* Filters */}
      <div data-testid="template-filters" style={{ display: 'flex', gap: '12px', marginBottom: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          data-testid="search-input"
          placeholder="Search templates..."
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            border: '1px solid #d1d5db',
            fontSize: '14px',
            backgroundColor: '#fff',
            color: '#1e293b',
            minWidth: '220px',
            outline: 'none',
          }}
        />
        <label htmlFor="type-filter" style={{ fontSize: '14px', fontWeight: 500, color: '#475569' }}>
          Filter by type:
        </label>
        <select
          id="type-filter"
          data-testid="type-filter-dropdown"
          value={typeFilter}
          onChange={(e) => handleTypeChange(e.target.value)}
          disabled={loadingTypes}
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            border: '1px solid #d1d5db',
            fontSize: '14px',
            backgroundColor: '#fff',
            color: '#1e293b',
            cursor: loadingTypes ? 'wait' : 'pointer',
            minWidth: '200px',
          }}
        >
          <option value="">All types</option>
          {availableTypes.map(type => (
            <option key={type} value={type} data-testid={`type-option-${type}`}>
              {formatTypeName(type)}
            </option>
          ))}
        </select>
        <label htmlFor="status-filter" style={{ fontSize: '14px', fontWeight: 500, color: '#475569' }}>
          Status:
        </label>
        <select
          id="status-filter"
          data-testid="status-filter-dropdown"
          value={statusFilter}
          onChange={(e) => handleStatusChange(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            border: '1px solid #d1d5db',
            fontSize: '14px',
            backgroundColor: '#fff',
            color: '#1e293b',
            cursor: 'pointer',
            minWidth: '150px',
          }}
        >
          <option value="">All statuses</option>
          <option value="draft" data-testid="status-option-draft">Draft</option>
          <option value="published" data-testid="status-option-published">Published</option>
          <option value="archived" data-testid="status-option-archived">Archived</option>
        </select>
        {loadingTypes && (
          <span data-testid="types-loading" style={{ fontSize: '12px', color: '#94a3b8' }}>Loading types...</span>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div data-testid="template-list-error" style={{ padding: '16px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#991b1b', marginBottom: '16px' }}>
          <strong>Error:</strong> {error}
          <button
            onClick={() => fetchTemplates(null)}
            style={{ marginLeft: '12px', padding: '4px 12px', borderRadius: '4px', border: '1px solid #fecaca', background: '#fff', cursor: 'pointer', fontSize: '13px' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div data-testid="template-list-loading" style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
          <div style={{ fontSize: '16px' }}>Loading templates...</div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && templates.length === 0 && (
        <div data-testid="template-list-empty" style={{ padding: '60px', textAlign: 'center', color: '#94a3b8', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px dashed #d1d5db' }}>
          <div style={{ fontSize: '18px', fontWeight: 500 }}>No templates found</div>
          <div style={{ fontSize: '14px', marginTop: '8px' }}>
            {searchQuery.trim() ? `No templates match "${searchQuery.trim()}".` : typeFilter ? `No templates match the "${formatTypeName(typeFilter)}" filter.` : 'Create your first template to get started.'}
          </div>
        </div>
      )}

      {/* Template cards */}
      {!loading && templates.length > 0 && (
        <div data-testid="template-list" style={{ display: 'grid', gap: '12px' }}>
          {templates.map((template) => {
            const sc = statusColor(template.status);
            const locked = isLockActive(template);
            return (
              <div
                key={template.id}
                data-testid={`template-card-${template.id}`}
                onClick={() => onSelectTemplate?.(template)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto auto auto auto',
                  alignItems: 'center',
                  gap: '16px',
                  padding: '16px 20px',
                  backgroundColor: '#fff',
                  border: locked ? '1px solid #fbbf24' : '1px solid #e2e8f0',
                  borderRadius: '8px',
                  cursor: onSelectTemplate ? 'pointer' : 'default',
                  transition: 'box-shadow 0.15s, border-color 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (!locked) {
                    (e.currentTarget as HTMLDivElement).style.borderColor = '#93c5fd';
                  }
                  (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = locked ? '#fbbf24' : '#e2e8f0';
                  (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
                }}
              >
                <div>
                  <div data-testid={`template-name-${template.id}`} style={{ fontSize: '15px', fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {template.name}
                    {locked && (
                      <span
                        data-testid={`lock-indicator-${template.id}`}
                        title={`Locked by ${template.lockedBy}${getLockExpiresAt(template) ? ` (expires ${formatDate(getLockExpiresAt(template)!)})` : ''}`}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#b45309', backgroundColor: '#fef3c7', padding: '2px 8px', borderRadius: '9999px', border: '1px solid #fcd34d', fontWeight: 500, whiteSpace: 'nowrap' }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        <span data-testid={`lock-holder-${template.id}`}>{template.lockedBy}</span>
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                    ID: {template.id}
                  </div>
                </div>
                <div data-testid={`template-type-${template.id}`} style={{ fontSize: '13px', color: '#475569', padding: '4px 10px', backgroundColor: '#f1f5f9', borderRadius: '4px' }}>
                  {formatTypeName(template.type)}
                </div>
                <div
                  data-testid={`template-status-${template.id}`}
                  style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    padding: '4px 10px',
                    borderRadius: '9999px',
                    backgroundColor: sc.bg,
                    color: sc.color,
                    border: `1px solid ${sc.border}`,
                  }}
                >
                  {template.status}
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', textAlign: 'right', minWidth: '130px' }}>
                  <div>v{template.version}</div>
                  <div>{formatDate(template.updatedAt || template.createdAt)}</div>
                </div>
                <button
                  data-testid={`btn-archive-${template.id}`}
                  onClick={(e) => handleArchive(template.id, e)}
                  disabled={archivingId === template.id}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid #fecaca',
                    backgroundColor: archivingId === template.id ? '#f3f4f6' : '#fff',
                    color: archivingId === template.id ? '#9ca3af' : '#dc2626',
                    cursor: archivingId === template.id ? 'not-allowed' : 'pointer',
                    fontSize: '12px',
                    fontWeight: 500,
                    opacity: archivingId === template.id ? 0.7 : 1,
                  }}
                >
                  {archivingId === template.id ? 'Archiving…' : 'Archive'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Load more button */}
      {!loading && pagination?.hasMore && (
        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <button
            data-testid="load-more-button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            style={{
              padding: '10px 24px',
              fontSize: '14px',
              fontWeight: 500,
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              backgroundColor: loadingMore ? '#f3f4f6' : '#fff',
              color: '#475569',
              cursor: loadingMore ? 'wait' : 'pointer',
            }}
          >
            {loadingMore ? 'Loading more...' : `Load More (${templates.length} of ${pagination.total})`}
          </button>
        </div>
      )}
    </div>
  );
}
