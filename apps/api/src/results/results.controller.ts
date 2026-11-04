import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import {
  RankingOverrideInput,
  TimeEventsBatchInput,
  type RaceResultsDto,
  type TimeEventHistoryDto,
  type TimeEventResult,
} from '@triatlon/shared';
import { interval, map, merge, type Observable } from 'rxjs';
import { CurrentUser, Roles, type RequestUser } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { RacesService } from '../races/races.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TimeEventsService } from '../time-events/time-events.service';
import { ResultsService } from './results.service';

const Uuid = new ParseUUIDPipe({ version: '4' });
const OptionalUuid = new ParseUUIDPipe({ version: '4', optional: true });

@Controller('races/:raceId')
export class ResultsController {
  constructor(
    private readonly results: ResultsService,
    private readonly timeEvents: TimeEventsService,
    private readonly races: RacesService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Zápis akcí z checkpointů (záznam času, vrácení, poznámka, korekce admina).
   * Vrací stav každé akce zvlášť; `duplicate` znamená, že už byla přijata dříve.
   */
  @Post('time-events')
  @HttpCode(200)
  ingest(
    @CurrentUser() user: RequestUser,
    @Param('raceId', Uuid) raceId: string,
    @Body(new ZodPipe(TimeEventsBatchInput)) body: TimeEventsBatchInput,
  ): Promise<TimeEventResult[]> {
    return this.timeEvents.ingest(user, raceId, body.events);
  }

  @Get('results')
  raceResults(
    @CurrentUser() user: RequestUser,
    @Param('raceId', Uuid) raceId: string,
    @Query('categoryId', OptionalUuid) categoryId?: string,
  ): Promise<RaceResultsDto> {
    return this.results.raceResults(user, raceId, categoryId);
  }

  @Get('participants/:participantId/history')
  history(
    @CurrentUser() user: RequestUser,
    @Param('raceId', Uuid) raceId: string,
    @Param('participantId', Uuid) participantId: string,
  ): Promise<TimeEventHistoryDto[]> {
    return this.results.history(user, raceId, participantId);
  }

  @Roles('admin')
  @Post('categories/:categoryId/ranking-overrides')
  @HttpCode(204)
  createOverride(
    @CurrentUser() user: RequestUser,
    @Param('raceId', Uuid) raceId: string,
    @Param('categoryId', Uuid) categoryId: string,
    @Body(new ZodPipe(RankingOverrideInput)) body: RankingOverrideInput,
  ): Promise<void> {
    return this.results.createOverride(user, raceId, categoryId, body);
  }

  @Roles('admin')
  @Delete('categories/:categoryId/ranking-overrides/:id')
  @HttpCode(204)
  removeOverride(
    @CurrentUser() user: RequestUser,
    @Param('raceId', Uuid) raceId: string,
    @Param('categoryId', Uuid) categoryId: string,
    @Param('id', Uuid) id: string,
  ): Promise<void> {
    return this.results.removeOverride(user, raceId, categoryId, id);
  }

  /**
   * Živý kanál (Server-Sent Events): zpráva při každé změně výsledků kategorie.
   * Klient čte přes fetch s hlavičkou Authorization (EventSource hlavičky neumí).
   * Heartbeat každých 25 s drží spojení přes proxy.
   */
  @Sse('stream')
  async stream(
    @CurrentUser() user: RequestUser,
    @Param('raceId', Uuid) raceId: string,
  ): Promise<Observable<MessageEvent>> {
    await this.races.assertAccess(user, raceId);
    return merge(
      this.realtime.stream(raceId).pipe(map((data) => ({ type: 'results', data }) as MessageEvent)),
      interval(25_000).pipe(map(() => ({ type: 'ping', data: '' }) as MessageEvent)),
    );
  }
}
