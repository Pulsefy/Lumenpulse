import {
  Controller,
  Request,
  Post,
  UseGuards,
  Get,
  Body,
  UnauthorizedException,
  UseInterceptors,
  ClassSerializerInterceptor,
  Query,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { GetChallengeDto, VerifyChallengeDto } from './dto/auth.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshTokenDto, LogoutDto } from './dto/refresh-token.dto';
import {
  TwoFactorGenerateResponseDto,
  TwoFactorEnableDto,
  TwoFactorVerifyDto,
  TwoFactorDisableDto,
  TwoFactorPendingResponseDto,
} from './dto/totp.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ProfileResponseDto } from '../users/dto/profile-response.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({
    status: 200,
    description: 'Login successful or 2FA required',
    schema: {
      oneOf: [
        {
          properties: {
            access_token: { type: 'string' },
            refresh_token: { type: 'string' },
          },
        },
        {
          properties: {
            requiresTwoFactor: { type: 'boolean', example: true },
            userId: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() body: LoginDto) {
    const user = await this.authService.validateUser(body.email, body.password);
    if (!user) {
      throw new UnauthorizedException();
    }

    // Check if 2FA is enabled
    const fullUser = await this.usersService.findById(user.id);
    if (fullUser?.twoFactorEnabled) {
      // Do NOT issue a session token yet
      return {
        requiresTwoFactor: true,
        userId: user.id,
      };
    }

    return this.authService.login(user);
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiResponse({
    status: 201,
    description: 'User registered successfully',
    schema: {
      properties: {
        id: { type: 'string' },
        email: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Email already exists' })
  async register(@Body() body: RegisterDto) {
    const existingUser = await this.usersService.findByEmail(body.email);
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const hash = await bcrypt.hash(body.password, 10);

    const user = await this.usersService.create({
      email: body.email,
      passwordHash: hash,
    });

    const { passwordHash: _, ...result } = user;
    void _;
    return result;
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset token' })
  @ApiResponse({
    status: 200,
    description: 'Reset token issued (email sending is mocked)',
    schema: {
      properties: {
        message: { type: 'string' },
      },
    },
  })
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.forgotPassword(body.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using a one-time token' })
  @ApiResponse({
    status: 200,
    description: 'Password has been reset successfully',
    schema: {
      properties: {
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid, expired, or already-used token',
  })
  async resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body.token, body.newPassword);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  @ApiResponse({
    status: 200,
    description: 'Token refreshed successfully',
    schema: {
      properties: {
        access_token: { type: 'string' },
        refresh_token: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or expired refresh token',
  })
  async refreshToken(
    @Body() body: RefreshTokenDto,
    @Request() req: ExpressRequest,
  ) {
    const ipAddress = req.ip || req.connection?.remoteAddress;
    return this.authService.refreshToken(
      body.refreshToken,
      body.deviceInfo,
      ipAddress,
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout user and invalidate refresh token' })
  @ApiResponse({
    status: 200,
    description: 'Logout successful',
    schema: {
      properties: {
        message: { type: 'string' },
      },
    },
  })
  async logout(@Body() body: LogoutDto) {
    return this.authService.logout(body.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout from all devices' })
  @ApiResponse({
    status: 200,
    description: 'Logout from all devices successful',
  })
  async logoutAll(@Request() req: { user: { sub: string } }) {
    return this.authService.logoutAll(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @UseInterceptors(ClassSerializerInterceptor)
  @Get('profile')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({
    status: 200,
    description: 'Profile retrieved successfully',
    type: ProfileResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getProfile(@Request() req: { user: { id: string } }) {
    const user = await this.usersService.findById(req.user.id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
      stellarPublicKey: user.stellarPublicKey,
      preferences: user.preferences,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/generate')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Generate TOTP secret and QR code for 2FA setup' })
  @ApiResponse({
    status: 200,
    description: 'QR code and OTP auth URI generated',
    type: TwoFactorGenerateResponseDto,
  })
  @ApiResponse({ status: 400, description: '2FA already enabled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async generateTwoFactor(@Request() req: { user: { sub: string } }) {
    return this.authService.generateTwoFactorSecret(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Verify TOTP and enable 2FA' })
  @ApiResponse({
    status: 200,
    description: '2FA enabled successfully',
    schema: {
      properties: {
        message: { type: 'string', example: '2FA enabled successfully' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid token or not pending' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async enableTwoFactor(
    @Request() req: { user: { sub: string } },
    @Body() body: TwoFactorEnableDto,
  ) {
    return this.authService.enableTwoFactor(req.user.sub, body.token);
  }

  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify TOTP during login (no auth required)' })
  @ApiResponse({
    status: 200,
    description: '2FA verified, login successful',
    schema: {
      properties: {
        access_token: { type: 'string' },
        refresh_token: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request or token',
  })
  async verifyTwoFactor(
    @Body() body: TwoFactorVerifyDto,
    @Request() req: ExpressRequest,
  ) {
    const ipAddress = req.ip || req.connection?.remoteAddress;
    // Note: Rate limiting should be applied to this endpoint in production
    return this.authService.verifyTwoFactor(
      body.userId,
      body.token,
      undefined,
      ipAddress,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Verify TOTP and disable 2FA' })
  @ApiResponse({
    status: 200,
    description: '2FA disabled successfully',
    schema: {
      properties: {
        message: { type: 'string', example: '2FA disabled successfully' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid token or 2FA not enabled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async disableTwoFactor(
    @Request() req: { user: { sub: string } },
    @Body() body: TwoFactorDisableDto,
  ) {
    return this.authService.disableTwoFactor(req.user.sub, body.token);
  }

  @Get('challenge')
  @ApiOperation({ summary: 'Get authentication challenge for Stellar wallet' })
  @ApiResponse({
    status: 200,
    description: 'Challenge generated successfully',
    schema: {
      properties: {
        challenge: { type: 'string' },
        nonce: { type: 'string' },
        expiresIn: { type: 'number' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid public key' })
  async getChallenge(@Query() getChallengeDto: GetChallengeDto) {
    try {
      this.logger.log(
        `Challenge requested for public key: ${getChallengeDto.publicKey}`,
      );

      const challenge = await this.authService.generateChallenge(
        getChallengeDto.publicKey,
      );

      return challenge;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error');

      this.logger.error(`Challenge generation failed: ${err.message}`);

      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: err.message,
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('verify')
  @ApiOperation({ summary: 'Verify signed challenge and issue JWT' })
  @ApiResponse({
    status: 200,
    description: 'Authentication successful',
    schema: {
      properties: {
        success: { type: 'boolean' },
        token: { type: 'string' },
        user: { type: 'object' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid signature or expired challenge',
  })
  async verifyChallenge(@Body() verifyChallengeDto: VerifyChallengeDto) {
    try {
      this.logger.log(
        `Verification requested for public key: ${verifyChallengeDto.publicKey}`,
      );

      const result = await this.authService.verifyChallenge(
        verifyChallengeDto.publicKey,
        verifyChallengeDto.signedChallenge,
      );

      this.logger.log(`Authentication successful for user: ${result.user.id}`);

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error');

      this.logger.error(`Verification failed: ${err.message}`);

      throw new HttpException(
        {
          statusCode: HttpStatus.UNAUTHORIZED,
          message: err.message,
          error: 'Unauthorized',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
  }
}
