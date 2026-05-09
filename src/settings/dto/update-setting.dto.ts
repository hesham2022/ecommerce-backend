import { ApiProperty } from '@nestjs/swagger';

export class UpdateSettingDto {
  @ApiProperty({
    description:
      'Replacement value for the setting key. Must match the type of the existing key.',
  })
  value!: unknown;
}
