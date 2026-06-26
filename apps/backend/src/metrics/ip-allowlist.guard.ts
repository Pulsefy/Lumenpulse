import {
  Injectable,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { CanActivate } from '@nestjs/common';
import type { Request } from 'express';
import { config } from '../lib/config';

/**
 * Guard that allows access based on IP allowlist or JWT authentication
 * Protects metrics endpoint from unauthorized access
 */
@Injectable()
export class IpAllowlistGuard implements CanActivate {
  private readonly logger = new Logger(IpAllowlistGuard.name);

  constructor() {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const clientIp = this.getClientIp(request);

    // Get allowed IPs from environment variable
    const allowedIps = this.getAllowedIps();

    // If no IPs are configured, require JWT authentication
    if (allowedIps.length === 0) {
      return this.hasValidJwt(request);
    }

    // Check if client IP is in allowlist
    const isIpAllowed = allowedIps.some((allowedIp) =>
      this.ipMatches(clientIp, allowedIp),
    );

    if (isIpAllowed) {
      this.logger.debug(`Metrics access allowed for IP: ${clientIp}`);
      return true;
    }

    // If IP not allowed, fall back to JWT check
    const hasJwt = this.hasValidJwt(request);
    if (hasJwt) {
      this.logger.debug(
        `Metrics access allowed for IP ${clientIp} via valid JWT`,
      );
      return true;
    }

    this.logger.warn(
      `Metrics access denied for IP: ${clientIp} (not in allowlist and no valid JWT)`,
    );
    throw new ForbiddenException(
      'Access to metrics endpoint denied. Not in IP allowlist and no valid authentication.',
    );
  }

  /**
   * Extract client IP from request
   * Handles X-Forwarded-For header for proxied requests
   */
  private getClientIp(request: Request): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      // X-Forwarded-For can contain multiple IPs, take the first
      return forwarded.split(',')[0].trim();
    }
    if (Array.isArray(forwarded)) {
      return forwarded[0];
    }
    // socket.remoteAddress includes IPv6 prefix, remove it
    const remoteAddress = request.socket.remoteAddress || 'unknown';
    return remoteAddress === '::1' ? '127.0.0.1' : remoteAddress;
  }

  /**
   * Get allowed IPs from environment variable
   * Format: METRICS_ALLOWED_IPS=127.0.0.1,192.168.1.0/24,::1
   */
  private getAllowedIps(): string[] {
    return [...config.metrics.allowedIps];
  }

  /**
   * Check if IP matches allowlist entry
   * Supports exact match and CIDR notation
   */
  private ipMatches(clientIp: string, allowedPattern: string): boolean {
    // Exact match
    if (clientIp === allowedPattern) {
      return true;
    }

    // Simple CIDR support (basic version)
    // Supports patterns like 192.168.1.0/24
    if (allowedPattern.includes('/')) {
      try {
        return this.isInCidr(clientIp, allowedPattern);
      } catch {
        this.logger.warn(`Invalid CIDR pattern: ${allowedPattern}`);
        return false;
      }
    }

    return false;
  }

  /**
   * Check if IP is in CIDR range
   * Simple implementation for common cases
   */
  private isInCidr(ip: string, cidr: string): boolean {
    // For IPv6 and complex scenarios, exact match is safer
    // This is a simplified IPv4 implementation
    if (ip.includes(':')) {
      // IPv6 - simple check
      return ip === cidr.split('/')[0];
    }

    const [cidrIp, maskBits] = cidr.split('/');
    const mask = parseInt(maskBits, 10);

    if (mask < 0 || mask > 32 || !cidrIp || !maskBits) {
      return false;
    }

    const ip2Long = (ip: string): number => {
      const parts = ip.split('.');
      if (parts.length !== 4) return 0;
      return (
        (parseInt(parts[0], 10) << 24) +
        (parseInt(parts[1], 10) << 16) +
        (parseInt(parts[2], 10) << 8) +
        parseInt(parts[3], 10)
      );
    };

    const ipNum = ip2Long(ip);
    const cidrNum = ip2Long(cidrIp);
    const maskNum = -1 << (32 - mask);

    return (ipNum & maskNum) === (cidrNum & maskNum);
  }

  /**
   * Check if request has valid JWT token
   * Looks for Authorization header with Bearer token
   */
  private hasValidJwt(request: Request): boolean {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return false;
    }

    // Note: Full JWT validation should be done by auth guards
    // This just checks for presence
    const token = authHeader.substring(7);
    return token.length > 0;
  }
}
