import { ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class UpdateSettingDto {
  @ApiProperty({
    description:
      'Replacement value for the setting key. Must match the type of the existing key.',
  })
  @Allow()
  value!: unknown;
}
