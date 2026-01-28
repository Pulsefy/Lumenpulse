import {
  Controller,
  Post,
  Get,
  Body,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
  ClassSerializerInterceptor,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import * as bcrypt from 'bcryptjs';

import { AuthService, SafeUser } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UsersService } from '../users/users.service';

import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ProfileDto } from './dto/profile.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Post('login')
  async login(@Body() body: LoginDto) {
    const user: SafeUser | null = await this.authService.validateUser(
      body.email,
      body.password,
    );

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.authService.login({ id: user.id, email: user.email });
  }

  @Post('register')
  async register(@Body() body: RegisterDto) {
    const passwordHash: string = await bcrypt.hash(body.password, 10);

    const user = await this.usersService.create({
      email: body.email,
      passwordHash,
    });

    const { passwordHash: _, ...safeUser } = user; // Remove password hash
    return safeUser;
  }

  @UseGuards(JwtAuthGuard)
  @UseInterceptors(ClassSerializerInterceptor)
  @Get('profile')
  getProfile(@Req() req: Request & { user: ProfileDto }) {
    return new ProfileDto(req.user);
  }
}
