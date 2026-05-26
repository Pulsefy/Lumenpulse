import {
  Controller,
  Get,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ContributorSnapshotRepository } from './contributor-snapshot.repository';
import { LeaderboardEntry, LeaderboardQuery } from './dto/contributor-snapshot.dto';

@Controller('contributor-snapshots')
export class ContributorSnapshotController {
  constructor(private readonly repo: ContributorSnapshotRepository) {}

  /**
   * GET /contributor-snapshots/leaderboard
   *
   * Returns the top-N contributors ranked by reputation score.
   *
   * Query params:
   *   limit  - number of entries to return (1–100, default 10)
   *   date   - YYYY-MM-DD UTC date; omit to use the latest snapshot date
   *
   * Example:
   *   GET /contributor-snapshots/leaderboard?limit=25&date=2026-05-25
   */
  @Get('leaderboard')
  async getLeaderboard(
    @Query() query: LeaderboardQuery,
  ): Promise<LeaderboardEntry[]> {
    const limit = this.parseLimit(query.limit);
    const date = this.parseDate(query.date);
    return this.repo.findTopN(limit, date);
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private parseLimit(raw: number | string | undefined): number {
    if (raw === undefined) return 10;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      throw new BadRequestException('limit must be an integer between 1 and 100');
    }
    return n;
  }

  private parseDate(raw: string | undefined): Date | undefined {
    if (!raw) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      throw new BadRequestException('date must be in YYYY-MM-DD format');
    }
    const d = new Date(`${raw}T00:00:00.000Z`);
    if (isNaN(d.getTime())) {
      throw new BadRequestException('date is not a valid calendar date');
    }
    return d;
  }
}
