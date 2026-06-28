import { CrowdfundService } from './crowdfund.service';

describe('CrowdfundService', () => {
  let service: CrowdfundService;

  beforeEach(() => {
    service = new CrowdfundService();
  });

  it('should bootstrap demo data and return created project IDs', () => {
    const result = service.bootstrapDemoData();

    expect(result).toBeDefined();
    expect(Array.isArray(result.projectIds)).toBe(true);
    expect(result.projectIds.length).toBe(3);
    expect(result.projectIds.every((id) => typeof id === 'number')).toBe(true);

    const projects = service.listProjects();
    expect(projects.length).toBeGreaterThanOrEqual(3);
    expect(projects.map((project) => project.id)).toEqual(
      expect.arrayContaining(result.projectIds),
    );
  });
});
