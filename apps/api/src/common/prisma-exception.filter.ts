import { Catch, ConflictException, NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '../generated/prisma/client';

/** Převede známé chyby Prismy na HTTP odpovědi s českou hláškou. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter extends BaseExceptionFilter {
  override catch(err: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    switch (err.code) {
      case 'P2002':
        return super.catch(new ConflictException('Záznam s těmito údaji už existuje.'), host);
      case 'P2003':
        return super.catch(
          new ConflictException(
            'Záznam nelze změnit ani smazat, protože na něj odkazují jiná data.',
          ),
          host,
        );
      case 'P2025':
        return super.catch(new NotFoundException('Záznam nenalezen.'), host);
      default:
        return super.catch(err, host);
    }
  }
}
