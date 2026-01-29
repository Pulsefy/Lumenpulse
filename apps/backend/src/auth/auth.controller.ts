import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  UseInterceptors,
  ClassSerializerInterceptor,
  UnauthorizedException,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtAuthGuard } from './jwt-auth.guard';

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
    const user = await this.authService.validateUser(body.email, body.password);

    if (!user) throw new UnauthorizedException();

    return this.authService.login({ id: user.id, email: user.email });
  }

  @Post('register')
  async register(@Body() body: RegisterDto) {
    const passwordHash = await bcrypt.hash(body.password, 10);
    return this.usersService.create({ email: body.email, passwordHash });
  }

  @UseGuards(JwtAuthGuard)
  @UseInterceptors(ClassSerializerInterceptor)
  @Get('profile')
  getProfile(@Req() req: Request & { user: ProfileDto }) {
    return new ProfileDto(req.user);
  }
}
