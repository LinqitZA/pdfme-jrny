import { Module, Global } from '@nestjs/common';
import { connectDatabase } from './connection';
import type { PdfmeDatabase } from './connection';

export const DRIZZLE = Symbol('DRIZZLE');

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: async (): Promise<PdfmeDatabase> => {
        return connectDatabase();
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {}
