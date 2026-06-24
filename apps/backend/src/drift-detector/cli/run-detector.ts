import '../../lib/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { DriftDetectorService } from '../drift-detector.service';

interface CliArgs {
  triggeredBy: string;
  outputJson: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  return {
    triggeredBy: 'cli',
    outputJson: args.includes('--json') || args.includes('-j'),
  };
}

async function main() {
  const args = parseArgs();

  console.log(`Drift detector CLI — triggeredBy=${args.triggeredBy}`);

  const app = await NestFactory.createApplicationContext(AppModule);
  const detector = app.get(DriftDetectorService);

  try {
    const report = await detector.runDetection(args.triggeredBy);

    if (args.outputJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log('');
      console.log('=== Drift Detection Report ===');
      console.log(`  ID:             ${report.id}`);
      console.log(`  Status:         ${report.status}`);
      console.log(`  Triggered by:   ${report.triggeredBy}`);
      console.log(`  Total scanned:  ${report.totalScanned}`);
      console.log(`  Total drifts:   ${report.totalDrifts}`);
      console.log(`  Critical:       ${report.criticalCount}`);
      console.log(`  High:           ${report.highCount}`);
      console.log(`  Medium:         ${report.mediumCount}`);
      console.log(`  Low:            ${report.lowCount}`);
      console.log(`  Duration:       ${report.durationMs}ms`);

      if (report.drifts && report.drifts.length > 0) {
        console.log('');
        console.log('Drift details:');
        for (const drift of report.drifts) {
          console.log(
            `  [${drift.severity}] ${drift.entityType}#${drift.entityId}: ${drift.detail}`,
          );
        }
      }

      console.log('');
      console.log(`Full report: GET /admin/drift-detector/reports/${report.id}`);
    }

    process.exit(report.status === 'failed' ? 1 : 0);
  } catch (err) {
    console.error('Drift detection failed:', err);
    process.exit(1);
  } finally {
    await app.close();
  }
}

main();
