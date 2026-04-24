/**
 * Project details manual tests
 *
 * These mirror the lightweight manual-test pattern already used in this app.
 * Run them in development until a full test runner is added.
 */

import {
  buildContributorFallbacks,
  getProjectPresentation,
} from '../project-details';
import { CrowdfundProject } from '../crowdfund';

const baseProject: CrowdfundProject = {
  id: 7,
  owner: 'GDUMMYOWNER',
  name: 'Soroban Grants Hub',
  targetAmount: '5000',
  tokenAddress: 'CDUMMYTOKEN',
  totalDeposited: '2500',
  totalWithdrawn: '0',
  isActive: true,
  contributorCount: 6,
};

export function testProjectPresentationFallbacks(): boolean {
  const presentation = getProjectPresentation(baseProject);

  const checks = [
    typeof presentation.description === 'string' && presentation.description.length > 0,
    typeof presentation.tagline === 'string' && presentation.tagline.length > 0,
    Array.isArray(presentation.roadmap) && presentation.roadmap.length > 0,
    Array.isArray(presentation.highlights) && presentation.highlights.length > 0,
  ];

  return checks.every(Boolean);
}

export function testProjectPresentationUsesApiHeroImage(): boolean {
  const presentation = getProjectPresentation({
    ...baseProject,
    heroImageUrl: 'https://example.com/hero.png',
  });

  return (
    typeof presentation.heroImage === 'object' &&
    presentation.heroImage !== null &&
    'uri' in presentation.heroImage &&
    presentation.heroImage.uri === 'https://example.com/hero.png'
  );
}

export function testContributorFallbackLimit(): boolean {
  const contributors = buildContributorFallbacks(baseProject, 10);
  return contributors.length === 4;
}

export function runProjectDetailsTests(): boolean {
  const results = [
    testProjectPresentationFallbacks(),
    testProjectPresentationUsesApiHeroImage(),
    testContributorFallbackLimit(),
  ];

  return results.every(Boolean);
}
