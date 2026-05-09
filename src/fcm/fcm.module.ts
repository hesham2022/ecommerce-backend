import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FcmTokenEntity } from './entities/fcm-token.entity';
import { FcmTokenController } from './fcm-token.controller';
import { FcmService } from './fcm.service';
import { FcmTokenService } from './fcm-token.service';

@Module({
  imports: [TypeOrmModule.forFeature([FcmTokenEntity])],
  controllers: [FcmTokenController],
  providers: [FcmService, FcmTokenService],
  exports: [FcmService, FcmTokenService],
})
export class FcmModule {}
