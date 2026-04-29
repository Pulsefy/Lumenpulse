import { Controller, Get, Post, Body, Param, Put, Req } from '@nestjs/common';
import { ProjectService } from './project.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ReviewProjectDto } from './dto/review-project.dto';

@Controller('projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  // --- CREATOR ENDPOINTS ---

  @Post()
  createDraft(@Body() createProjectDto: CreateProjectDto, @Req() req: any) {
    // Note: If you don't have auth guards wired up yet, req.user will be undefined.
    // Adding a fallback string here so you can test it immediately without crashing.
    const userId = req?.user?.id || 'test-user-id'; 
    return this.projectService.createDraft(createProjectDto, userId);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateProjectDto: UpdateProjectDto, @Req() req: any) {
    const userId = req?.user?.id || 'test-user-id';
    return this.projectService.update(id, updateProjectDto, userId);
  }

  @Post(':id/submit')
  submitForReview(@Param('id') id: string, @Req() req: any) {
    const userId = req?.user?.id || 'test-user-id';
    return this.projectService.submitForReview(id, userId);
  }

  // --- REVIEWER ENDPOINTS ---

  @Get('reviews/pending')
  getPendingReviews() {
    return this.projectService.getPendingReviews();
  }

  @Post(':id/review')
  reviewProject(@Param('id') id: string, @Body() reviewDto: ReviewProjectDto) {
    return this.projectService.reviewProject(id, reviewDto);
  }
}