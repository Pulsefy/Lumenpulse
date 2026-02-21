import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';

@Controller('test')
export class TestController {
  @Get('hello')
  getHello(): string {
    return 'Hello World!';
  }

  @Post('submit')
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
  getError(): void {
    throw new Error('Test error for logging');
  }

  @Get('not-found')
  getNotFound(): void {
    throw new Error('Resource not found');
  }

  @Get('redirect')
  getRedirect(): Record<string, unknown> {
    return { redirect: true, destination: '/test/hello' };
  }

  @Put('update/:id')
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
  deleteData(@Param('id') id: string): { message: string; id: string } {
    return {
      message: 'Data deleted successfully',
      id,
    };
  }
}
