/**
 * Drizzle ORM schema definitions for pdfme ERP Edition
 *
 * Tables: Template, GeneratedDocument, UserSignature, RenderBatch, AuditLog
 */

// To be implemented with Drizzle ORM by coding agents
// Schema matches app_spec.txt database_schema section

/*
Template:
  - id (cuid, PK)
  - orgId (string, nullable — null = system template)
  - type (string — invoice | statement | purchase_order | delivery_note | credit_note | report_* | custom)
  - name (string)
  - schema (jsonb — pdfme Template JSON)
  - status (string — draft | published | archived)
  - version (integer, default 1)
  - saveMode (string, nullable — inPlace | newVersion)
  - publishedVer (integer, nullable)
  - forkedFromId (string, nullable — FK)
  - createdAt (timestamp)
  - updatedAt (timestamp)
  - createdBy (string — userId)
  - lockedBy (string, nullable)
  - lockedAt (timestamp, nullable)
  - Index: [orgId, type, status]

GeneratedDocument:
  - id (cuid, PK)
  - orgId (string)
  - templateId (string — FK)
  - templateVer (integer)
  - entityType (string)
  - entityId (string)
  - filePath (string)
  - pdfHash (string — SHA-256)
  - status (string — queued | generating | done | failed)
  - outputChannel (string — email | print)
  - triggeredBy (string — userId)
  - inputSnapshot (jsonb, nullable)
  - errorMessage (string, nullable)
  - createdAt (timestamp)

UserSignature:
  - id (cuid, PK)
  - orgId (string)
  - userId (string)
  - filePath (string)
  - capturedAt (timestamp)
  - revokedAt (timestamp, nullable)
  - Unique: [orgId, userId]

RenderBatch:
  - id (cuid, PK)
  - orgId (string)
  - templateType (string)
  - channel (string — email | print)
  - totalJobs (integer)
  - completedJobs (integer, default 0)
  - failedJobs (integer, default 0)
  - failedIds (text array)
  - status (string — running | completed | completedWithErrors | aborted)
  - onFailure (string — continue | abort)
  - notifyUrl (string, nullable)
  - createdAt (timestamp)
  - completedAt (timestamp, nullable)

AuditLog:
  - id (cuid, PK)
  - orgId (string)
  - entityType (string)
  - entityId (string)
  - action (string)
  - userId (string)
  - metadata (jsonb, nullable)
  - createdAt (timestamp)
  - APPEND-ONLY: no UPDATE or DELETE
*/

export {};
