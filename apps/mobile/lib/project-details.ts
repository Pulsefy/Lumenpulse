import { ImageSourcePropType } from 'react-native';
import { CrowdfundProject, ProjectContributor } from './crowdfund';

type RoadmapStatus = 'complete' | 'current' | 'upcoming';

export interface ProjectRoadmapItem {
  title: string;
  detail: string;
  status: RoadmapStatus;
}

export interface ProjectPresentation {
  category: string;
  tagline: string;
  description: string;
  longDescription: string;
  heroLabel: string;
  highlights: string[];
  roadmap: ProjectRoadmapItem[];
  heroImage: ImageSourcePropType;
}

const defaultHeroImage = require('../assets/icon.png');

const PROJECT_PRESENTATIONS: Record<string, ProjectPresentation> = {
  default: {
    category: 'Ecosystem Build',
    tagline: 'Open infrastructure moving from idea to on-chain utility.',
    description:
      'This project is building practical tooling for the Stellar and Soroban ecosystem, with transparent milestone delivery and community-backed funding.',
    longDescription:
      'Lumenpulse tracks each project as a living initiative rather than a static listing. Contributors can follow what the team is trying to ship, how much funding has reached the vault, and which milestones are actively being delivered next.',
    heroLabel: 'Community-backed roadmap',
    highlights: ['Transparent goals', 'Milestone-driven releases', 'Vault-based funding'],
    roadmap: [
      {
        title: 'Foundation',
        detail: 'Validate scope, define the delivery plan, and align the initial contributor base.',
        status: 'complete',
      },
      {
        title: 'Active Build',
        detail: 'Ship the current milestone, gather usage feedback, and improve the on-chain workflow.',
        status: 'current',
      },
      {
        title: 'Scale Out',
        detail: 'Expand integrations, documentation, and ecosystem partnerships after launch.',
        status: 'upcoming',
      },
    ],
    heroImage: defaultHeroImage,
  },
};

function normalizeProjectKey(project: Pick<CrowdfundProject, 'id' | 'name'>): string[] {
  const normalizedName = project.name.trim().toLowerCase();
  return [`id:${project.id}`, normalizedName];
}

export function getProjectPresentation(project: CrowdfundProject): ProjectPresentation {
  const keys = normalizeProjectKey(project);

  for (const key of keys) {
    if (PROJECT_PRESENTATIONS[key]) {
      return PROJECT_PRESENTATIONS[key];
    }
  }

  return {
    ...PROJECT_PRESENTATIONS.default,
    category: project.category || PROJECT_PRESENTATIONS.default.category,
    tagline:
      project.tagline ||
      `${project.name} is rallying ecosystem contributors around a focused funding goal.`,
    description: project.description || PROJECT_PRESENTATIONS.default.description,
    heroImage: project.heroImageUrl
      ? { uri: project.heroImageUrl }
      : PROJECT_PRESENTATIONS.default.heroImage,
    roadmap:
      project.milestones?.map((milestone) => ({
        title: milestone.title,
        detail: milestone.detail || 'Milestone details will be published as the team progresses.',
        status: milestone.status || 'upcoming',
      })) || PROJECT_PRESENTATIONS.default.roadmap,
  };
}

export function buildContributorFallbacks(
  project: CrowdfundProject,
  count: number,
): ProjectContributor[] {
  const total = Math.min(count, 4);

  return Array.from({ length: total }, (_, index) => ({
    id: `fallback-${project.id}-${index}`,
    name: `Community Backer ${index + 1}`,
    handle: `supporter${index + 1}`,
  }));
}
