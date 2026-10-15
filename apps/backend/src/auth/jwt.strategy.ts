import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { User } from '../users/entities/user.entity';

export interface JwtPayload {
  sub: string; // user id
  stellarPublicKey: string;
  type: string;
  iat?: number;
  exp?: number;
  email?: string;
  role?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    const { sub: userId } = payload;

    const user = await this.userRepository.findOne({
      where: { id: userId },
      // role column is selected by default
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // An erased account is kept only as an anonymised tombstone; it must never
    // be able to authenticate again, even with a previously issued token.
    if (!user.id || user.deletedAt) {
      throw new UnauthorizedException('User account is inactive');
    }

    return user;
  }
}
