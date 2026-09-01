import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { VerificationService } from './verification.service';
import {
  CastVoteDto,
  OverrideDto,
  RegisterProjectDto,
  UpdateConfigDto,
  VerificationStatus,
  ProjectVerificationDto,
  VoteResultDto,
  RegistryConfigDto,
  UpsertSubmissionDto,
  ProjectSubmissionDto,
  SubmissionStatus,
  SubmissionActionDto,
} from './dto/verification.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';
import { AuditBlockchainAction } from '../admin-audit/decorators/audit-blockchain-action.decorator';
import { AdminAuditInterceptor } from '../admin-audit/interceptors/admin-audit.interceptor';
import { ApiIdempotencyHeader } from '../common/decorators/api-idempotency.decorator';

@ApiTags('verification')
@Controller('verification')
export class VerificationController {
  constructor(private readonly svc: VerificationService) {}

  @Get('config')
  @ApiOperation({
    summary: 'Get verification registry config',
    description:
      'Retrieve current quorum settings and voting weight calculation mode.',
  })
  @ApiResponse({
    status: 200,
    description: 'Registry configuration retrieved successfully',
    type: RegistryConfigDto,
  })
  getConfig() {
    return this.svc.getConfig();
  }

  @Put('config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(AdminAuditInterceptor)
  @AuditBlockchainAction({})
  @ApiIdempotencyHeader()
  @ApiOperation({
    summary: 'Update verification registry config',
    description:
      'Updates quorum settings and minimum voter weights. Requires authentication.',
  })
  @ApiResponse({
    status: 200,
    description: 'Registry configuration updated successfully',
    type: RegistryConfigDto,
  })
  @ApiResponse({
    status: 400,
    description: 'quorumThreshold must be >= 1',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  updateConfig(@Body() dto: UpdateConfigDto) {
    return this.svc.updateConfig(dto);
  }

  @Get('projects')
  @ApiOperation({
    summary: 'List project verification records',
    description:
      'Retrieve a list of project verification records, optionally filtered by status.',
  })
  @ApiQuery({ name: 'status', required: false, enum: VerificationStatus })
  @ApiResponse({
    status: 200,
    description: 'Verification records retrieved successfully',
    type: [ProjectVerificationDto],
  })
  listProjects(@Query('status') status?: VerificationStatus) {
    return this.svc.listProjects(status);
  }

  @Get('projects/:id')
  @ApiOperation({
    summary: 'Get project verification record details',
    description: 'Retrieves a single project verification record by its ID.',
  })
  @ApiResponse({
    status: 200,
    description: 'Verification record details retrieved successfully',
    type: ProjectVerificationDto,
  })
  @ApiResponse({ status: 404, description: 'Record not found' })
  getProject(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getProject(id);
  }

  @Get('projects/:id/verified')
  @ApiOperation({
    summary: 'Check if a project is verified',
    description:
      'Quick check to determine if a project is fully verified on the platform.',
  })
  @ApiResponse({
    status: 200,
    description: 'Verification status check completed',
    schema: {
      properties: {
        projectId: { type: 'number', example: 42 },
        verified: { type: 'boolean', example: true },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Record not found' })
  isVerified(@Param('id', ParseIntPipe) id: number) {
    return { projectId: id, verified: this.svc.isVerified(id) };
  }

  @Post('projects')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(AdminAuditInterceptor)
  @AuditBlockchainAction({ contractField: 'ownerPublicKey' })
  @ApiIdempotencyHeader()
  @ApiOperation({
    summary: 'Register a project for verification',
    description:
      'Submit a new project to the verification registry. Requires authentication.',
  })
  @ApiResponse({
    status: 201,
    description: 'Project registered successfully',
    type: ProjectVerificationDto,
  })
  @ApiResponse({ status: 400, description: 'Project already registered' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  registerProject(@Body() dto: RegisterProjectDto) {
    return this.svc.registerProject(dto);
  }

  @Post('vote')
  @ApiIdempotencyHeader()
  @ApiOperation({
    summary: 'Cast a verification vote',
    description:
      'Submit a weighted vote for or against a project verification.',
  })
  @ApiResponse({
    status: 200,
    description: 'Vote cast and tallied successfully',
    type: VoteResultDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Project is no longer accepting votes, or this voter has already voted on it',
  })
  @ApiResponse({
    status: 403,
    description: 'Voter weight is below the configured minimum',
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  castVote(@Body() dto: CastVoteDto) {
    return this.svc.castVote(dto);
  }

  @Post('override')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(AdminAuditInterceptor)
  @AuditBlockchainAction({ contractField: 'projectId' })
  @ApiIdempotencyHeader()
  @ApiOperation({
    summary: 'Override project verification status',
    description:
      'Directly verify or reject a project (admin override). Requires authentication.',
  })
  @ApiResponse({
    status: 200,
    description: 'Verification status overridden successfully',
    type: ProjectVerificationDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  override(@Body() dto: OverrideDto) {
    return this.svc.overrideVerification(dto);
  }

  @Get('submissions')
  @ApiOperation({
    summary: 'List project submissions',
    description:
      'Returns project submissions across draft/review/approval/publish workflow states.',
  })
  @ApiQuery({ name: 'status', required: false, enum: SubmissionStatus })
  @ApiResponse({
    status: 200,
    description: 'Submission records retrieved successfully',
    type: [ProjectSubmissionDto],
  })
  listSubmissions(@Query('status') status?: SubmissionStatus) {
    return this.svc.listSubmissions(status);
  }

  @Get('submissions/:id')
  @ApiOperation({
    summary: 'Get project submission details',
    description: 'Retrieves a single project submission record by its ID.',
  })
  @ApiResponse({
    status: 200,
    description: 'Submission record retrieved successfully',
    type: ProjectSubmissionDto,
  })
  @ApiResponse({ status: 404, description: 'Submission not found' })
  getSubmission(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getSubmission(id);
  }

  @Post('submissions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiIdempotencyHeader()
  @ApiOperation({
    summary: 'Save submission draft',
    description:
      'Creates or updates a project submission draft that can later enter review.',
  })
  @ApiResponse({
    status: 201,
    description: 'Submission draft saved',
    type: ProjectSubmissionDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Submission is already published and cannot be edited',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  upsertSubmission(@Body() dto: UpsertSubmissionDto) {
    return this.svc.upsertSubmission(dto);
  }

  @Post('submissions/:id/submit')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiIdempotencyHeader()
  @ApiOperation({
    summary: 'Submit draft for review',
    description:
      'Moves a submission from draft (or changes-requested) into the review state.',
  })
  @ApiResponse({
    status: 201,
    description: 'Submission moved to review',
    type: ProjectSubmissionDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Submission is already published or already in review',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Submission not found' })
  submitForReview(@Param('id', ParseIntPipe) id: number) {
    return this.svc.submitForReview(id);
  }

  @Post('submissions/:id/request-changes')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiIdempotencyHeader()
  @ApiOperation({
    summary: 'Request changes on submission',
    description:
      'Reviewer/admin action that moves an in-review submission back to changes-requested.',
  })
  @ApiResponse({
    status: 201,
    description: 'Submission returned to changes-requested state',
    type: ProjectSubmissionDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Submission must be in review to request changes',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Submission not found' })
  requestChanges(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubmissionActionDto,
  ) {
    return this.svc.requestSubmissionChanges(id, dto);
  }

  @Post('submissions/:id/approve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiIdempotencyHeader()
  @ApiOperation({
    summary: 'Approve submission for publishing',
    description:
      'Reviewer/admin action that moves an in-review submission to approved.',
  })
  @ApiResponse({
    status: 201,
    description: 'Submission approved',
    type: ProjectSubmissionDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Submission must be in review to approve',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Submission not found' })
  approveSubmission(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubmissionActionDto,
  ) {
    return this.svc.approveSubmission(id, dto);
  }

  @Post('submissions/:id/publish')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiIdempotencyHeader()
  @ApiOperation({
    summary: 'Publish approved submission',
    description:
      'Reviewer/admin action that moves an approved submission to published.',
  })
  @ApiResponse({
    status: 201,
    description: 'Submission published',
    type: ProjectSubmissionDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Submission must be approved before publishing',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Submission not found' })
  publishSubmission(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubmissionActionDto,
  ) {
    return this.svc.publishSubmission(id, dto);
  }
}
