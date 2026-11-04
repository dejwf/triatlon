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
  ImportRowsInput,
  ParticipantInput,
  ParticipantUpdateInput,
  type ImportResult,
  type ParticipantDto,
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
}
