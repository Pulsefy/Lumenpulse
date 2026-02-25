import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { LinkStellarAccountDto } from './dto/link-stellar-account.dto';
import { StellarAccountResponseDto } from './dto/stellar-account-response.dto';
import { UpdateStellarAccountLabelDto } from './dto/update-stellar-account-label.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

// Unified Authenticated Request Interface
interface RequestWithUser extends Request {
  user: {
    id: string;
    email?: string;
    role?: string;
  };
}

@ApiTags('users')
@ApiBearerAuth('JWT-auth')
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // --- ADMIN/GENERAL ENDPOINTS ---

  @Get()
  @ApiOperation({ summary: 'Get all users' })
  @ApiResponse({ status: 200, description: 'List of all users', type: [User] })
  async findAll(): Promise<User[]> {
    return this.usersService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiResponse({ status: 200, description: 'User found', type: User })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findById(@Param('id') id: string): Promise<User | null> {
    return this.usersService.findById(id);
  }

  // --- PROFILE MANAGEMENT (From Upstream) ---

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  async getProfile(@Req() req: RequestWithUser): Promise<ProfileResponseDto> {
    const userId = req.user.id;
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new Error('User not found');
    }

    return new ProfileResponseDto({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
      stellarPublicKey: user.stellarPublicKey,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  }

  @Patch('me')
  @UsePipes(new ValidationPipe())
  @ApiOperation({ summary: 'Update current user profile' })
  async updateProfile(
    @Req() req: RequestWithUser,
    @Body() updateProfileDto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    const userId = req.user.id;

    const allowedUpdates: Partial<User> = {};
    if (updateProfileDto.displayName !== undefined)
      allowedUpdates.displayName = updateProfileDto.displayName;
    if (updateProfileDto.bio !== undefined)
      allowedUpdates.bio = updateProfileDto.bio;
    if (updateProfileDto.avatarUrl !== undefined)
      allowedUpdates.avatarUrl = updateProfileDto.avatarUrl;

    const updatedUser = await this.usersService.update(userId, allowedUpdates);

    return new ProfileResponseDto({
      id: updatedUser.id,
      email: updatedUser.email,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      displayName: updatedUser.displayName,
      bio: updatedUser.bio,
      avatarUrl: updatedUser.avatarUrl,
      stellarPublicKey: updatedUser.stellarPublicKey,
      createdAt: updatedUser.createdAt,
      updatedAt: updatedUser.updatedAt,
    });
  }

  // --- STELLAR ACCOUNT MANAGEMENT (From Feature Branch) ---

  @Post('me/accounts')
  @ApiOperation({ summary: 'Link a new Stellar account to user profile' })
  @ApiResponse({ status: 201, type: StellarAccountResponseDto })
  async addStellarAccount(
    @Req() req: RequestWithUser,
    @Body() dto: LinkStellarAccountDto,
  ): Promise<StellarAccountResponseDto> {
    return this.usersService.addStellarAccount(req.user.id, dto);
  }

  @Get('me/accounts')
  @ApiOperation({ summary: 'Get all linked Stellar accounts for current user' })
  @ApiResponse({ status: 200, type: [StellarAccountResponseDto] })
  async getMyStellarAccounts(
    @Req() req: RequestWithUser,
  ): Promise<StellarAccountResponseDto[]> {
    return this.usersService.getStellarAccounts(req.user.id);
  }

  @Get('me/accounts/:id')
  @ApiOperation({ summary: 'Get a specific Stellar account for current user' })
  @ApiResponse({ status: 200, type: StellarAccountResponseDto })
  async getMyStellarAccount(
    @Req() req: RequestWithUser,
    @Param('id') accountId: string,
  ): Promise<StellarAccountResponseDto> {
    return this.usersService.getStellarAccount(req.user.id, accountId);
  }

  @Delete('me/accounts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unlink a Stellar account from current user' })
  async removeMyStellarAccount(
    @Req() req: RequestWithUser,
    @Param('id') accountId: string,
  ): Promise<void> {
    await this.usersService.removeStellarAccount(req.user.id, accountId);
  }

  @Patch('me/accounts/:id/label')
  @ApiOperation({ summary: 'Update account label for current user' })
  async updateMyStellarAccountLabel(
    @Req() req: RequestWithUser,
    @Param('id') accountId: string,
    @Body() dto: UpdateStellarAccountLabelDto,
  ): Promise<StellarAccountResponseDto> {
    return this.usersService.updateStellarAccountLabel(
      req.user.id,
      accountId,
      dto,
    );
  }

  @Post('me/accounts/:id/primary')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set as primary account for current user' })
  async setMyPrimaryAccount(
    @Req() req: RequestWithUser,
    @Param('id') accountId: string,
  ): Promise<void> {
    await this.usersService.setPrimaryAccount(req.user.id, accountId);
  }
}
