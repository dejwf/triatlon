import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  AnonymizeInput,
  ImportRowsInput,
  OnSiteRegistrationInput,
  ParticipantStatusInput,
  type OnSiteRegistrationResult,
  ParticipantInput,
  ParticipantUpdateInput,
  type ImportResult,
  type ParticipantDto,
  type ParticipantExportDto,
} from '@triatlon/shared';
import { CurrentUser, Roles, type RequestUser } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ParticipantsService } from './participants.service';

const Uuid = new ParseUUIDPipe({ version: '4' });
const OptionalUuid = new ParseUUIDPipe({ version: '4', optional: true });

@Controller('races/:raceId/participants')
export class ParticipantsController {
  constructor(private readonly participants: ParticipantsService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param('raceId', Uuid) raceId: string,
    @Query('categoryId', OptionalUuid) categoryId?: string,
  ): Promise<ParticipantDto[]> {
    return this.participants.list(user, raceId, categoryId);
  }

  @Roles('admin')
  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param('raceId', Uuid) raceId: string,
    @Body(new ZodPipe(ParticipantInput)) body: ParticipantInput,
  ): Promise<ParticipantDto> {
    return this.participants.create(user, raceId, body);
  }

  /** Náhled importu — validace bez uložení. */
  @Roles('admin')
  @Post('import/preview')
  @HttpCode(200)
  preview(
    @CurrentUser() user: RequestUser,
    @Param('raceId', Uuid) raceId: string,
    @Body(new ZodPipe(ImportRowsInput)) body: ImportRowsInput,
  ): Promise<ImportResult> {
    return this.participants.import(user, raceId, body.rows, true);
  }

  /** Import všech řádků, nebo žádného (422 s výsledkem validace). */
  @Roles('admin')
  @Post('import')
  import(
    @CurrentUser() user: RequestUser,
    @Param('raceId', Uuid) raceId: string,
    @Body(new ZodPipe(ImportRowsInput)) body: ImportRowsInput,
  ): Promise<ImportResult> {
    return this.participants.import(user, raceId, body.rows, false);
  }

  /** Registrace na místě (mobil, organizátor startu). */
  @Post('on-site')
  @HttpCode(200)
  registerOnSite(
    @CurrentUser() user: RequestUser,
    @Param('raceId', Uuid) raceId: string,
    @Body(new ZodPipe(OnSiteRegistrationInput)) body: OnSiteRegistrationInput,
  ): Promise<OnSiteRegistrationResult> {
    return this.participants.registerOnSite(user, raceId, body);
  }

  /** Check-in: přítomen / nepřítomen (mobil, organizátor startu). */
  @Post(':id/status')
  @HttpCode(200)
  setStatus(
    @CurrentUser() user: RequestUser,
    @Param('raceId', Uuid) raceId: string,
    @Param('id', Uuid) id: string,
    @Body(new ZodPipe(ParticipantStatusInput)) body: ParticipantStatusInput,
  ): Promise<ParticipantDto> {
    return this.participants.setStatus(user, raceId, id, body.status);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('raceId', Uuid) raceId: string,
    @Param('id', Uuid) id: string,
    @Body(new ZodPipe(ParticipantUpdateInput)) body: ParticipantUpdateInput,
  ): Promise<ParticipantDto> {
    return this.participants.update(user, raceId, id, body);
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: RequestUser,
    @Param('raceId', Uuid) raceId: string,
    @Param('id', Uuid) id: string,
  ): Promise<void> {
    return this.participants.remove(user, raceId, id);
  }

  /** GDPR: export osobních údajů závodníka (JSON). */
  @Roles('admin')
  @Get(':id/export')
  export(
    @CurrentUser() user: RequestUser,
    @Param('raceId', Uuid) raceId: string,
    @Param('id', Uuid) id: string,
  ): Promise<ParticipantExportDto> {
    return this.participants.export(user, raceId, id);
  }

  /** GDPR: anonymizace osobních údajů (časy a pořadí zůstanou). */
  @Roles('admin')
  @Post(':id/anonymize')
  @HttpCode(200)
  anonymize(
    @CurrentUser() user: RequestUser,
    @Param('raceId', Uuid) raceId: string,
    @Param('id', Uuid) id: string,
    @Body(new ZodPipe(AnonymizeInput)) body: AnonymizeInput,
  ): Promise<ParticipantDto> {
    return this.participants.anonymize(user, raceId, id, body.reason);
  }
}
