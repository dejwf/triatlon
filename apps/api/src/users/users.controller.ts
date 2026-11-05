import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import {
  AssignmentsInput,
  DirectorInput,
  UserCreateInput,
  UserUpdateInput,
  type AssignmentDto,
  type UserDto,
} from '@triatlon/shared';
import { CurrentUser, Roles, type RequestUser } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { RacesService } from '../races/races.service';
import { UsersService } from './users.service';

const Uuid = new ParseUUIDPipe({ version: '4' });

@Roles('admin')
@Controller()
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly races: RacesService,
  ) {}

  @Get('users')
  list(): Promise<UserDto[]> {
    return this.users.list();
  }

  @Post('users')
  create(
    @CurrentUser() actor: RequestUser,
    @Body(new ZodPipe(UserCreateInput)) body: UserCreateInput,
  ): Promise<UserDto> {
    return this.users.create(actor, body);
  }

  @Patch('users/:id')
  update(
    @CurrentUser() actor: RequestUser,
    @Param('id', Uuid) id: string,
    @Body(new ZodPipe(UserUpdateInput)) body: UserUpdateInput,
  ): Promise<UserDto> {
    return this.users.update(actor, id, body);
  }

  @Get('races/:raceId/assignments')
  async assignments(
    @CurrentUser() actor: RequestUser,
    @Param('raceId', Uuid) raceId: string,
  ): Promise<AssignmentDto[]> {
    await this.races.assertAccess(actor, raceId);
    return this.users.assignments(raceId);
  }

  @Put('races/:raceId/assignments/:userId')
  async setAssignments(
    @CurrentUser() actor: RequestUser,
    @Param('raceId', Uuid) raceId: string,
    @Param('userId', Uuid) userId: string,
    @Body(new ZodPipe(AssignmentsInput)) body: AssignmentsInput,
  ): Promise<AssignmentDto[]> {
    await this.races.assertAccess(actor, raceId);
    return this.users.setAssignments(actor, raceId, userId, body.checkpointIds);
  }

  /** Ředitelé závodu (smí uzavírat kategorie). */
  @Get('races/:raceId/directors')
  async directors(
    @CurrentUser() actor: RequestUser,
    @Param('raceId', Uuid) raceId: string,
  ): Promise<string[]> {
    await this.races.assertAccess(actor, raceId);
    return this.users.directors(raceId);
  }

  @Put('races/:raceId/directors/:userId')
  async setDirector(
    @CurrentUser() actor: RequestUser,
    @Param('raceId', Uuid) raceId: string,
    @Param('userId', Uuid) userId: string,
    @Body(new ZodPipe(DirectorInput)) body: DirectorInput,
  ): Promise<string[]> {
    await this.races.assertAccess(actor, raceId);
    return this.users.setDirector(actor, raceId, userId, body.director);
  }
}
