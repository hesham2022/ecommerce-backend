import { IsString, Matches } from 'class-validator';

export class UpdateCommissionDto {
  @IsString()
  @Matches(/^(0(\.\d{1,4})?|1(\.0{1,4})?)$/, {
    message:
      'commissionRate must be between "0" and "1" with up to 4 decimal places',
  })
  commissionRate!: string;
}
