import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EntityAlias } from '../database/entities/entity-alias.entity';
import { EntityAliasService } from './entity-alias.service';
import { EntityAliasController } from './entity-alias.controller';

@Module({
  imports: [TypeOrmModule.forFeature([EntityAlias])],
  controllers: [EntityAliasController],
  providers: [EntityAliasService],
  exports: [EntityAliasService],
})
export class EntityAliasModule {}
