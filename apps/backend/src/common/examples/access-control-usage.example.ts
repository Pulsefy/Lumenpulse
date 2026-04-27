import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AccessControlGuard } from '../guards/access-control.guard';
import {
  RequirePermission,
  RequireUserRead,
  RequireUserWrite,
  RequirePortfolioRead,
  RequirePortfolioWrite,
  RequireWebhookVerification,
  RequireIpAllowlist,
  GetAccessContext,
  GetResource,
  GetPermissionResult,
} from '../decorators/access-control.decorators';
import {
  AccessControlContext,
  AccessControlResource,
  PermissionResult,
  AccessAction,
  ResourceType,
} from '../interfaces/access-control.interface';

/**
 * Example controller demonstrating how to use the shared access control interface
 * This is for documentation purposes and should not be included in production
 */
@Controller('example')
@UseGuards(JwtAuthGuard, AccessControlGuard)
export class AccessControlExampleController {
  /**
   * Example 1: Simple user resource access
   * Only the user themselves or admins can read user profiles
   */
  @Get('users/:userId')
  @RequireUserRead('userId')
  async getUserProfile(
    @Param('userId') userId: string,
    @GetAccessContext() context: AccessControlContext,
    @GetResource() resource: AccessControlResource,
    @GetPermissionResult() permissionResult: PermissionResult,
  ) {
    // The guard has already verified that the user has permission
    // You can access the context, resource, and permission result if needed
    return {
      message: `Access granted to user ${userId}`,
      context: context,
      resource: resource,
      permissionResult: permissionResult,
    };
  }

  /**
   * Example 2: User-owned resource access
   * Users can read their own portfolios, reviewers can read any portfolio
   */
  @Get('users/:userId/portfolios/:portfolioId')
  @RequirePortfolioRead('portfolioId', 'userId')
  async getPortfolio(
    @Param('userId') userId: string,
    @Param('portfolioId') portfolioId: string,
  ) {
    return {
      message: `Access granted to portfolio ${portfolioId} owned by ${userId}`,
    };
  }

  /**
   * Example 3: Write operations with ownership check
   * Only the owner can update their portfolio
   */
  @Put('users/:userId/portfolios/:portfolioId')
  @RequirePortfolioWrite('portfolioId', 'userId')
  async updatePortfolio(
    @Param('userId') userId: string,
    @Param('portfolioId') portfolioId: string,
    @Body() updateData: any,
  ) {
    return {
      message: `Portfolio ${portfolioId} updated successfully`,
    };
  }

  /**
   * Example 4: Custom permission requirements
   * Reviewers can manage grants
   */
  @Post('grants')
  @RequirePermission({
    action: AccessAction.WRITE,
    resourceType: ResourceType.GRANT,
    resourceIdParam: 'grantId', // Will be extracted from body
  })
  async createGrant(@Body() grantData: { grantId: string; [key: string]: any }) {
    return {
      message: `Grant ${grantData.grantId} created successfully`,
    };
  }

  /**
   * Example 5: Admin-only operations
   * Only admins can delete users
   */
  @Delete('users/:userId')
  @RequirePermission({
    action: AccessAction.ADMIN,
    resourceType: ResourceType.USER,
    resourceIdParam: 'userId',
  })
  async deleteUser(@Param('userId') userId: string) {
    return {
      message: `User ${userId} deleted successfully`,
    };
  }

  /**
   * Example 6: Webhook endpoint with signature verification
   * Requires valid webhook signature from a trusted provider
   */
  @Post('webhooks/payment')
  @RequireWebhookVerification(true)
  async handlePaymentWebhook(@Body() webhookData: any) {
    return {
      message: 'Payment webhook processed successfully',
      data: webhookData,
    };
  }

  /**
   * Example 7: IP allowlist protection
   * Metrics endpoint accessible only from allowed IPs or with JWT
   */
  @Get('metrics')
  @RequireIpAllowlist(false) // Optional - falls back to JWT if IP not allowed
  async getMetrics() {
    return {
      message: 'Metrics data',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Example 8: Public endpoint (no access control)
   * Health check endpoint accessible to everyone
   */
  @Get('health')
  async getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Example 9: Complex permission with custom logic
   * Users can read news, but only published news for regular users
   */
  @Get('news/:newsId')
  @RequirePermission({
    action: AccessAction.READ,
    resourceType: ResourceType.NEWS,
    resourceIdParam: 'newsId',
  })
  async getNews(
    @Param('newsId') newsId: string,
    @GetAccessContext() context: AccessControlContext,
  ) {
    // Additional business logic can be applied here
    // For example, regular users might only see published news
    const isReviewerOrAdmin = context.userRole === 'reviewer' || context.userRole === 'admin';
    
    return {
      message: `News ${newsId} retrieved`,
      canViewDrafts: isReviewerOrAdmin,
    };
  }

  /**
   * Example 10: Multiple verification types
   * Endpoint that accepts both authenticated users and webhook calls
   */
  @Post('notifications')
  @RequirePermission({
    action: AccessAction.WRITE,
    resourceType: 'notification',
    resourceIdParam: 'notificationId',
  })
  async createNotification(
    @Body() notificationData: { notificationId: string; [key: string]: any },
    @GetAccessContext() context: AccessControlContext,
  ) {
    const source = context.webhookProvider ? 'webhook' : 'user';
    
    return {
      message: `Notification ${notificationData.notificationId} created`,
      source,
    };
  }
}

/**
 * Example service demonstrating programmatic use of the access control service
 */
export class AccessControlExampleService {
  constructor(private readonly accessControlService: any) {} // AccessControlService

  /**
   * Example of programmatic permission checking
   */
  async checkUserCanAccessPortfolio(
    userId: string,
    portfolioId: string,
    ownerId: string,
  ): Promise<boolean> {
    const context = {
      userId,
      userRole: await this.getUserRole(userId),
    };

    const resource = {
      type: ResourceType.PORTFOLIO,
      id: portfolioId,
      ownerId,
    };

    const result = await this.accessControlService.checkPermission({
      action: AccessAction.READ,
      resource,
      context,
    });

    return result.granted;
  }

  /**
   * Example of trusted caller verification
   */
  async verifyWebhookCall(
    provider: string,
    signature: string,
    rawBody: Buffer,
  ): Promise<boolean> {
    const result = await this.accessControlService.verifyTrustedCaller({
      verificationType: 'webhook_signature',
      verificationData: {
        provider,
        signature,
      },
      rawData: rawBody,
    });

    return result.trusted;
  }

  /**
   * Example of role checking
   */
  async isUserAdmin(userId: string): Promise<boolean> {
    return this.accessControlService.hasRole(userId, 'admin');
  }

  private async getUserRole(userId: string): Promise<string> {
    // Implementation would fetch user role from database
    return 'user';
  }
}