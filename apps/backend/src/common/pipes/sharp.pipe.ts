import { Injectable, PipeTransform } from '@nestjs/common';
import sharp from 'sharp';

@Injectable()
export class SharpPipe implements PipeTransform<
  Express.Multer.File,
  Promise<Buffer>
> {
  async transform(image: Express.Multer.File): Promise<Buffer> {
    const optimizedBuffer: Buffer = await sharp(image.buffer)
      .resize(500, 500, { fit: 'cover', position: 'center' })
      .webp({ quality: 80 })
      .toBuffer();

    return optimizedBuffer;
  }
}
