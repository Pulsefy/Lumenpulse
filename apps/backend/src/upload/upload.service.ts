import {
  Injectable,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

@Injectable()
export class UploadService implements OnModuleInit {
  constructor(private readonly configService: ConfigService) {}

  private s3Client!: S3Client;
  private bucketName!: string;

  onModuleInit() {
    this.bucketName = this.configService.getOrThrow<string>('AWS_BUCKET_NAME');
    this.s3Client = new S3Client({
      region: this.configService.getOrThrow<string>('AWS_REGION'),
      credentials: {
        accessKeyId: this.configService.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.getOrThrow<string>(
          'AWS_SECRET_ACCESS_KEY',
        ),
      },
    });
  }

  async uploadFile(fileBuffer: Buffer, fileName: string) {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: fileName,
        Body: fileBuffer,
        ContentType: 'image/webp',
      });

      await this.s3Client.send(command);

      return `https://${this.bucketName}.s3.${this.configService.getOrThrow<string>('AWS_REGION')}.amazonaws.com/${fileName}`;
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException(error);
    }
  }
}
