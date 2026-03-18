/**
 * PrinterService - Printer CRUD and raw TCP socket send
 *
 * Manages printer configurations and sends raw PDF bytes to
 * network printers via TCP socket (port 9100 - RAW/JetDirect protocol).
 */

import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import * as net from 'net';
import { printers } from './db/schema';
import type { PdfmeDatabase } from './db/connection';

/** SSRF protection: only allow private network IPs */
function isPrivateNetwork(host: string): boolean {
  // Allow common private network ranges and localhost
  const privatePatterns = [
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
    /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/,
    /^192\.168\.\d{1,3}\.\d{1,3}$/,
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
    /^localhost$/i,
    /^0\.0\.0\.0$/,
  ];
  return privatePatterns.some((p) => p.test(host));
}

export interface CreatePrinterDto {
  name: string;
  host: string;
  port?: number;
  type?: string;
  isDefault?: boolean;
}

@Injectable()
export class PrinterService {
  private readonly logger = new Logger(PrinterService.name);

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: PdfmeDatabase,
  ) {}

  async create(orgId: string, dto: CreatePrinterDto) {
    // SSRF protection
    if (!isPrivateNetwork(dto.host)) {
      throw new Error(`SSRF_BLOCKED: Printer host '${dto.host}' is not on a private network`);
    }

    const id = createId();
    const now = new Date();
    const record = {
      id,
      orgId,
      name: dto.name,
      host: dto.host,
      port: dto.port || 9100,
      type: dto.type || 'raw',
      isDefault: dto.isDefault ? 'true' : 'false',
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(printers).values(record);
    return record;
  }

  async findAll(orgId: string) {
    return this.db
      .select()
      .from(printers)
      .where(eq(printers.orgId, orgId));
  }

  async findById(orgId: string, id: string) {
    const results = await this.db
      .select()
      .from(printers)
      .where(and(eq(printers.id, id), eq(printers.orgId, orgId)));
    return results[0] || null;
  }

  async delete(orgId: string, id: string) {
    const existing = await this.findById(orgId, id);
    if (!existing) return null;
    await this.db.delete(printers).where(and(eq(printers.id, id), eq(printers.orgId, orgId)));
    return existing;
  }

  /**
   * Send raw PDF bytes to a printer via TCP socket.
   * Connection timeout: 5s, send timeout: 30s.
   */
  async sendToPrinter(host: string, port: number, pdfData: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const connectTimeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Connection timeout: could not connect to ${host}:${port} within 5s`));
      }, 5000);

      socket.connect(port, host, () => {
        clearTimeout(connectTimeout);
        const sendTimeout = setTimeout(() => {
          socket.destroy();
          reject(new Error(`Send timeout: data transfer to ${host}:${port} exceeded 30s`));
        }, 30000);

        socket.write(pdfData, (err) => {
          clearTimeout(sendTimeout);
          if (err) {
            socket.destroy();
            reject(new Error(`Send error: ${err.message}`));
          } else {
            socket.end(() => resolve());
          }
        });
      });

      socket.on('error', (err) => {
        clearTimeout(connectTimeout);
        reject(new Error(`Socket error: ${err.message}`));
      });
    });
  }

  /** Validate that a host is on a private network (for controller use) */
  static validateHost(host: string): boolean {
    return isPrivateNetwork(host);
  }
}
