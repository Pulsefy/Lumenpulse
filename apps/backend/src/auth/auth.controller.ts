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
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ProfileDto } from './dto/profile.dto';
import { GetChallengeDto, VerifyChallengeDto } from './dto/auth.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshTokenDto, LogoutDto } from './dto/refresh-token.dto';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
  ) {}

  @Post('login')
  async login(@Body() body: LoginDto) {
    const user = await this.authService.validateUser(body.email, body.password);
    if (!user) {
      throw new UnauthorizedException();
    }
    return this.authService.login(user);
  }

  @Post('register')
  async register(@Body() body: RegisterDto) {
    const hash = await bcrypt.hash(body.password, 10);

    return this.usersService.create({ email: body.email, passwordHash: hash });
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
  getProfile(@Request() req: { user: ProfileDto }) {
    return new ProfileDto(req.user);
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
