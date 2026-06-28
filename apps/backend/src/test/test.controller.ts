import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { FeatureFlag } from '../feature-flags/feature-flag.decorator';
import { FeatureFlagGuard } from '../feature-flags/feature-flag.guard';

@ApiTags('test')
@Controller('test')
export class TestController {
  @Get('hello')
  @UseGuards(FeatureFlagGuard)
  @FeatureFlag('test.hello')
  @ApiOperation({
    summary: 'Hello World feature flagged endpoint',
    description:
      'Returns hello message if "test.hello" feature flag is enabled.',
  })
  @ApiResponse({ status: 200, description: 'Success message', type: String })
  @ApiResponse({
    status: 403,
    description: 'Forbidden (Feature flag disabled)',
  })
  getHello(): string {
    return 'Hello World!';
  }

  @Post('submit')
  @ApiOperation({
    summary: 'Submit diagnostic data',
    description: 'Echos submitted payload back with a timestamp for testing.',
  })
  @ApiResponse({
    status: 200,
    description: 'Data submitted successfully',
    schema: {
      properties: {
        message: { type: 'string', example: 'Data submitted successfully' },
        timestamp: { type: 'string', format: 'date-time' },
        receivedData: { type: 'object' },
      },
    },
  })
  submitData(@Body() body: Record<string, unknown>): {
    message: string;
    timestamp: Date;
    receivedData?: Record<string, unknown>;
  } {
    return {
      message: 'Data submitted successfully',
      timestamp: new Date(),
      receivedData: body,
    };
  }

  @Get('error')
  @ApiOperation({
    summary: 'Trigger standard Error for testing logs',
    description:
      'Throws a generic Error to confirm that error log interceptors trigger.',
  })
  @ApiResponse({ status: 500, description: 'Throws standard Error' })
  getError(): void {
    throw new Error('Test error for logging');
  }

  @Get('not-found')
  @ApiOperation({
    summary: 'Trigger Not Found Error for testing logs',
    description:
      'Throws a generic not found Error to verify filter intercepts.',
  })
  @ApiResponse({ status: 500, description: 'Throws resource not found error' })
  getNotFound(): void {
    throw new Error('Resource not found');
  }

  @Get('redirect')
  @ApiOperation({
    summary: 'Mock redirect response metadata',
    description: 'Returns mock redirection data.',
  })
  @ApiResponse({
    status: 200,
    description: 'Redirection payload',
    schema: {
      properties: {
        redirect: { type: 'boolean', example: true },
        destination: { type: 'string', example: '/test/hello' },
      },
    },
  })
  getRedirect(): Record<string, unknown> {
    return { redirect: true, destination: '/test/hello' };
  }

  @Put('update/:id')
  @ApiOperation({
    summary: 'Update diagnostic data',
    description: 'Echos updated body back with specified id.',
  })
  @ApiParam({
    name: 'id',
    description: 'Diagnostic item ID',
    example: 'diag_123',
  })
  @ApiResponse({
    status: 200,
    description: 'Data updated successfully',
    schema: {
      properties: {
        message: { type: 'string', example: 'Data updated successfully' },
        id: { type: 'string', example: 'diag_123' },
        updatedData: { type: 'object' },
      },
    },
  })
  updateData(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): { message: string; id: string; updatedData: Record<string, unknown> } {
    return {
      message: 'Data updated successfully',
      id,
      updatedData: body,
    };
  }

  @Delete('delete/:id')
  @ApiOperation({
    summary: 'Delete diagnostic data',
    description: 'Confirms deletion of item ID.',
  })
  @ApiParam({
    name: 'id',
    description: 'Diagnostic item ID to delete',
    example: 'diag_123',
  })
  @ApiResponse({
    status: 200,
    description: 'Data deleted successfully',
    schema: {
      properties: {
        message: { type: 'string', example: 'Data deleted successfully' },
        id: { type: 'string', example: 'diag_123' },
      },
    },
  })
  deleteData(@Param('id') id: string): { message: string; id: string } {
    return {
      message: 'Data deleted successfully',
      id,
    };
  }
}
