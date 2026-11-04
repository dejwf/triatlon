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
  Put,
} from '@nestjs/common';
import {
  CategoryUpdateInput,
  CheckpointInput,
  type CheckpointData,
  CheckpointOrderInput,
  RaceCreateInput,
  RaceUpdateInput,
  type CheckpointDto,
  type RaceDetailDto,
  type RaceSummaryDto,
} from '@triatlon/shared';
import { CurrentUser, Roles, type RequestUser } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { RacesService } from './races.service';

const Uuid = new ParseUUIDPipe({ version: '4' });

@Controller('races')
export class RacesController {
  constructor(private readonly races: RacesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser): Promise<RaceSummaryDto[]> {
    return this.races.list(user);
  }

  @Get(':id')
  get(@CurrentUser() user: RequestUser, @Param('id', Uuid) id: string): Promise<RaceDetailDto> {
    return this.races.get(user, id);
  }

  @Roles('admin')
  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(RaceCreateInput)) body: RaceCreateInput,
  ): Promise<RaceDetailDto> {
    return this.races.create(user, body);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', Uuid) id: string,
    @Body(new ZodPipe(RaceUpdateInput)) body: RaceUpdateInput,
  ): Promise<RaceDetailDto> {
    return this.races.update(user, id, body);
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: RequestUser, @Param('id', Uuid) id: string): Promise<void> {
    return this.races.remove(user, id);
  }

  @Roles('admin')
  @Post(':id/checkpoints')
  addCheckpoint(
    @CurrentUser() user: RequestUser,
    @Param('id', Uuid) raceId: string,
    @Body(new ZodPipe(CheckpointInput)) body: CheckpointData,
  ): Promise<CheckpointDto> {
    return this.races.addCheckpoint(user, raceId, body);
  }

  @Roles('admin')
  @Put(':id/checkpoints/order')
  reorderCheckpoints(
    @CurrentUser() user: RequestUser,
    @Param('id', Uuid) raceId: string,
    @Body(new ZodPipe(CheckpointOrderInput)) body: CheckpointOrderInput,
  ): Promise<CheckpointDto[]> {
    return this.races.reorderCheckpoints(user, raceId, body.checkpointIds);
  }

  @Roles('admin')
  @Patch(':id/checkpoints/:checkpointId')
  updateCheckpoint(
    @CurrentUser() user: RequestUser,
    @Param('id', Uuid) raceId: string,
    @Param('checkpointId', Uuid) id: string,
    @Body(new ZodPipe(CheckpointInput)) body: CheckpointData,
  ): Promise<CheckpointDto> {
    return this.races.updateCheckpoint(user, raceId, id, body);
  }

  @Roles('admin')
  @Delete(':id/checkpoints/:checkpointId')
  @HttpCode(204)
  removeCheckpoint(
    @CurrentUser() user: RequestUser,
    @Param('id', Uuid) raceId: string,
    @Param('checkpointId', Uuid) id: string,
  ): Promise<void> {
    return this.races.removeCheckpoint(user, raceId, id);
  }

  @Roles('admin')
  @Patch(':id/categories/:categoryId')
  @HttpCode(204)
  updateCategory(
    @CurrentUser() user: RequestUser,
    @Param('id', Uuid) raceId: string,
    @Param('categoryId', Uuid) id: string,
    @Body(new ZodPipe(CategoryUpdateInput)) body: CategoryUpdateInput,
  ): Promise<void> {
    return this.races.updateCategory(user, raceId, id, body);
  }
}
