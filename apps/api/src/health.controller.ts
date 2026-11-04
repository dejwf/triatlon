import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  async health(): Promise<{ status: 'ok'; db: boolean }> {
    const db = await this.prisma.$queryRaw`SELECT 1`.then(
      () => true,
      () => false,
    );
    return { status: 'ok', db };
  }

  /** Serverový čas — mobilní klient si podle něj počítá offset svých hodin (CLAUDE.md, F3). */
  @Get('time')
  time(): { now: string } {
    return { now: new Date().toISOString() };
  }
}
