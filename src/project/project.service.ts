import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project, ProjectStatus } from './entities/project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ReviewProjectDto, ReviewAction } from './dto/review-project.dto';

@Injectable()
export class ProjectService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
  ) {}

  // 1. Create a Draft
  async createDraft(createProjectDto: CreateProjectDto, userId: string) {
    const project = this.projectRepository.create({
      ...createProjectDto,
      authorId: userId,
      status: ProjectStatus.DRAFT,
    });
    return this.projectRepository.save(project);
  }

  // 2. Update a Draft
  async update(id: string, updateProjectDto: UpdateProjectDto, userId: string) {
    const project = await this.projectRepository.findOne({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.authorId !== userId) throw new ForbiddenException('You do not own this project');

    if (project.status === ProjectStatus.PENDING_REVIEW || project.status === ProjectStatus.PUBLISHED) {
      throw new BadRequestException(`Cannot edit project while in ${project.status} state`);
    }

    Object.assign(project, updateProjectDto);
    return this.projectRepository.save(project);
  }

  // 3. Submit for Review
  async submitForReview(id: string, userId: string) {
    const project = await this.projectRepository.findOne({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.authorId !== userId) throw new ForbiddenException('You do not own this project');

    if (project.status !== ProjectStatus.DRAFT && project.status !== ProjectStatus.CHANGES_REQUESTED) {
      throw new BadRequestException('Invalid state transition');
    }

    project.status = ProjectStatus.PENDING_REVIEW;
    project.reviewNotes = null; // Clear old notes
    return this.projectRepository.save(project);
  }

  // 4. Get Pending Reviews (For Admins/Reviewers)
  async getPendingReviews() {
    return this.projectRepository.find({
      where: { status: ProjectStatus.PENDING_REVIEW },
      order: { updatedAt: 'DESC' },
    });
  }

  // 5. Execute Review (Approve or Reject)
  async reviewProject(id: string, reviewDto: ReviewProjectDto) {
    const project = await this.projectRepository.findOne({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    
    if (project.status !== ProjectStatus.PENDING_REVIEW) {
      throw new BadRequestException('Project is not pending review');
    }

    if (reviewDto.action === ReviewAction.APPROVE) {
      project.status = ProjectStatus.PUBLISHED;
      project.publishedAt = new Date();
      project.reviewNotes = null;
    } else if (reviewDto.action === ReviewAction.REQUEST_CHANGES) {
      if (!reviewDto.notes) throw new BadRequestException('Notes are required when requesting changes');
      project.status = ProjectStatus.CHANGES_REQUESTED;
      project.reviewNotes = reviewDto.notes;
    }

    return this.projectRepository.save(project);
  }
}