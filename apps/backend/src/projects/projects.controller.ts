import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Request,
  Query,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ProjectSubmissionsService } from './projects.service';
import { CreateProjectSubmissionDto } from './dto/create-project-submission.dto';
import { UpdateProjectSubmissionDto } from './dto/update-project-submission.dto';
import { SubmitForReviewDto } from './dto/submit-for-review.dto';
import { ReviewSubmissionDto } from './dto/review-submission.dto';
import { ProjectSubmissionResponseDto, ListProjectSubmissionsDto } from './dto/project-submission-response.dto';
import { ReviewerGuard } from './guards/reviewer.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Projects')
@Controller('api/projects')
export class ProjectSubmissionsController {
  constructor(private readonly projectsService: ProjectSubmissionsService) {}

  /**
   * Create a new draft project submission
   */
  @Post('submissions/draft')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a new draft project submission',
    description: 'Create a new draft project submission that can be edited before submitting for review',
  })
  async createDraft(
    @Request() req,
    @Body() createDto: CreateProjectSubmissionDto,
  ): Promise<ProjectSubmissionResponseDto> {
    const submission = await this.projectsService.createDraft(req.user.id, createDto);
    return ProjectSubmissionResponseDto.fromEntity(submission);
  }

  /**
   * Update a draft submission
   */
  @Post('submissions/:id/update')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update an existing draft submission',
    description: 'Update a draft submission or one with requested changes',
  })
  async updateDraft(
    @Request() req,
    @Param('id') submissionId: string,
    @Body() updateDto: UpdateProjectSubmissionDto,
  ): Promise<ProjectSubmissionResponseDto> {
    const submission = await this.projectsService.updateDraft(
      submissionId,
      req.user.id,
      updateDto,
    );
    return ProjectSubmissionResponseDto.fromEntity(submission);
  }

  /**
   * Submit a draft for review
   */
  @Post('submissions/:id/submit-for-review')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Submit a draft for review',
    description: 'Move a draft submission to under_review status for reviewer evaluation',
  })
  async submitForReview(
    @Request() req,
    @Param('id') submissionId: string,
    @Body() submitDto: SubmitForReviewDto,
  ): Promise<ProjectSubmissionResponseDto> {
    const submission = await this.projectsService.submitForReview(
      submissionId,
      req.user.id,
      submitDto,
    );
    return ProjectSubmissionResponseDto.fromEntity(submission);
  }

  /**
   * Get a submission by ID
   */
  @Get('submissions/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get a project submission by ID',
  })
  async getSubmission(
    @Param('id') submissionId: string,
  ): Promise<ProjectSubmissionResponseDto> {
    const submission = await this.projectsService.getSubmissionById(submissionId);
    return ProjectSubmissionResponseDto.fromEntity(submission);
  }

  /**
   * List user's submissions
   */
  @Get('my-submissions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Get current user's project submissions",
  })
  async getUserSubmissions(
    @Request() req,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ): Promise<ListProjectSubmissionsDto> {
    const { submissions, total } = await this.projectsService.getUserSubmissions(
      req.user.id,
      page || 1,
      limit || 10,
    );
    return {
      data: submissions.map((s) => ProjectSubmissionResponseDto.fromEntity(s)),
      total,
      page: page || 1,
      limit: limit || 10,
      totalPages: Math.ceil(total / (limit || 10)),
    };
  }

  /**
   * List submissions for review (reviewer endpoint)
   */
  @Get('submissions-for-review')
  @UseGuards(JwtAuthGuard, ReviewerGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List submissions pending review (admin only)',
    description: 'Get all submissions that are under review and pending reviewer action',
  })
  async getSubmissionsForReview(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ): Promise<ListProjectSubmissionsDto> {
    const { submissions, total } = await this.projectsService.getSubmissionsForReview(
      page || 1,
      limit || 10,
    );
    return {
      data: submissions.map((s) => ProjectSubmissionResponseDto.fromEntity(s)),
      total,
      page: page || 1,
      limit: limit || 10,
      totalPages: Math.ceil(total / (limit || 10)),
    };
  }

  /**
   * Request changes on a submission (reviewer action)
   */
  @Post('submissions/:id/request-changes')
  @UseGuards(JwtAuthGuard, ReviewerGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request changes on a submission (admin only)',
    description: 'Request changes from the creator and provide feedback',
  })
  async requestChanges(
    @Request() req,
    @Param('id') submissionId: string,
    @Body() reviewDto: ReviewSubmissionDto,
  ): Promise<ProjectSubmissionResponseDto> {
    const submission = await this.projectsService.requestChanges(
      submissionId,
      req.user.id,
      reviewDto,
    );
    return ProjectSubmissionResponseDto.fromEntity(submission);
  }

  /**
   * Approve a submission (reviewer action)
   */
  @Post('submissions/:id/approve')
  @UseGuards(JwtAuthGuard, ReviewerGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a submission (admin only)',
    description: 'Approve a submission to move it to the approved status',
  })
  async approveSubmission(
    @Request() req,
    @Param('id') submissionId: string,
    @Body() reviewDto: ReviewSubmissionDto,
  ): Promise<ProjectSubmissionResponseDto> {
    const submission = await this.projectsService.approveSubmission(
      submissionId,
      req.user.id,
      reviewDto,
    );
    return ProjectSubmissionResponseDto.fromEntity(submission);
  }

  /**
   * Reject a submission (reviewer action)
   */
  @Post('submissions/:id/reject')
  @UseGuards(JwtAuthGuard, ReviewerGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject a submission (admin only)',
    description: 'Reject a submission and provide feedback to the creator',
  })
  async rejectSubmission(
    @Request() req,
    @Param('id') submissionId: string,
    @Body() reviewDto: ReviewSubmissionDto,
  ): Promise<ProjectSubmissionResponseDto> {
    const submission = await this.projectsService.rejectSubmission(
      submissionId,
      req.user.id,
      reviewDto,
    );
    return ProjectSubmissionResponseDto.fromEntity(submission);
  }

  /**
   * Publish an approved submission
   */
  @Post('submissions/:id/publish')
  @UseGuards(JwtAuthGuard, ReviewerGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Publish an approved submission (admin only)',
    description: 'Move an approved submission to published status, making it public',
  })
  async publishSubmission(
    @Request() req,
    @Param('id') submissionId: string,
  ): Promise<ProjectSubmissionResponseDto> {
    const submission = await this.projectsService.publishSubmission(
      submissionId,
      req.user.id,
    );
    return ProjectSubmissionResponseDto.fromEntity(submission);
  }

  /**
   * Delete a draft submission
   */
  @Delete('submissions/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a draft submission',
    description: 'Delete a draft submission (only drafts can be deleted)',
  })
  async deleteDraft(
    @Request() req,
    @Param('id') submissionId: string,
  ): Promise<void> {
    await this.projectsService.deleteDraft(submissionId, req.user.id);
  }

  /**
   * Get published projects (public endpoint)
   */
  @Get('published')
  @ApiOperation({
    summary: 'Get published projects (public)',
    description: 'Get all published projects with pagination',
  })
  async getPublishedProjects(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ): Promise<ListProjectSubmissionsDto> {
    const { projects, total } = await this.projectsService.listPublishedProjects(
      page || 1,
      limit || 10,
    );
    return {
      data: projects.map((p) => ProjectSubmissionResponseDto.fromEntity(p)),
      total,
      page: page || 1,
      limit: limit || 10,
      totalPages: Math.ceil(total / (limit || 10)),
    };
  }

  /**
   * Add a comment to a submission
   */
  @Post('submissions/:id/comments')
  @UseGuards(JwtAuthGuard, ReviewerGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Add a comment to a submission (admin only)',
  })
  async addComment(
    @Request() req,
    @Param('id') submissionId: string,
    @Body('message') message: string,
  ) {
    if (!message) {
      throw new BadRequestException('Message is required');
    }
    const feedback = await this.projectsService.addComment(
      submissionId,
      req.user.id,
      message,
    );
    return feedback;
  }

  /**
   * Resolve feedback
   */
  @Post('feedback/:feedbackId/resolve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resolve a feedback item',
  })
  async resolveFeedback(
    @Param('feedbackId') feedbackId: string,
  ) {
    return this.projectsService.resolveFeedback(feedbackId);
  }
}
