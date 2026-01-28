import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs'; // Use bcryptjs for proper types
import { User } from '../users/entities/user.entity';

export type SafeUser = Omit<User, 'passwordHash'>;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Validate a user with email and password.
   * Returns user without passwordHash if valid, otherwise null.
   */
  async validateUser(email: string, pass: string): Promise<SafeUser | null> {
    const user: User | null = await this.usersService.findByEmail(email);

    if (!user || !user.passwordHash) {
      return null;
    }

    const isMatch: boolean = await bcrypt.compare(pass, user.passwordHash);
    if (!isMatch) {
      return null;
    }

    // Remove passwordHash from returned object
    const { passwordHash, ...result } = user;
    return result;
  }

  /**
   * Generate JWT token for a user
   */
  login(user: { id: string; email: string }) {
    const payload = { email: user.email, sub: user.id };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}
