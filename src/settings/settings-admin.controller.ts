import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../roles/roles.decorator';
import { RolesGuard } from '../roles/roles.guard';
import { RoleEnum } from '../roles/roles.enum';
import { AdminAuditLogService } from '../admin-audit-log/admin-audit-log.service';
import { SettingsService } from './settings.service';
import { SettingsShape } from './domain/setting';
import { UpdateSettingDto } from './dto/update-setting.dto';

type SettingKey = keyof SettingsShape;
type SettingType = 'boolean' | 'string';

// Whitelist of admin-mutable keys, with their expected runtime type.
// `default_region_id` from the spec is aliased to `default_region_code` in this
// codebase (region lookups currently happen by ISO-style code, not uuid).
const ALLOWED: Record<SettingKey, SettingType> = {
  multi_region_enabled: 'boolean',
  vendors_auto_approve: 'boolean',
  products_auto_approve: 'boolean',
  default_region_code: 'string',
  default_locale_code: 'string',
};

const SETTING_KEY_ALIASES: Record<string, SettingKey> = {
  default_region_id: 'default_region_code',
};

@ApiTags('Admin · Settings')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(RoleEnum.admin)
@Controller({ path: 'admin/settings', version: '1' })
export class SettingsAdminController {
  constructor(
    private readonly service: SettingsService,
    private readonly audit: AdminAuditLogService,
  ) {}

  @Get()
  @ApiOkResponse({
    description: 'Returns all settings as a flat key/value map.',
    schema: { type: 'object', additionalProperties: true },
  })
  list(): Promise<SettingsShape> {
    return this.service.get();
  }

  @Get(':key')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { key: { type: 'string' }, value: {} },
    },
  })
  async getOne(@Param('key') rawKey: string) {
    const key = this.resolveKey(rawKey);
    const all = await this.service.get();
    return { key, value: all[key] };
  }

  @Patch(':key')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { key: { type: 'string' }, value: {} },
    },
  })
  async patchOne(
    @Req() req: Request,
    @Param('key') rawKey: string,
    @Body() body: UpdateSettingDto,
  ) {
    const key = this.resolveKey(rawKey);
    const expected = ALLOWED[key];
    const value = body?.value;
    if (value === undefined) {
      throw new UnprocessableEntityException({
        errors: { value: 'value is required' },
      });
    }
    if (!this.isType(value, expected)) {
      throw new UnprocessableEntityException({
        errors: {
          value: `expected ${expected} for setting "${rawKey}"`,
        },
      });
    }

    const before = await this.service.get();
    const previousValue = before[key];
    const next = await this.service.update({
      [key]: value,
    } as Partial<SettingsShape>);

    const adminUserId = (req.user as { id: number }).id;
    await this.audit.log({
      adminUserId,
      action: 'settings.update',
      targetType: 'setting',
      targetId: rawKey,
      payload: { from: previousValue, to: value },
    });

    return { key, value: next[key] };
  }

  private resolveKey(rawKey: string): SettingKey {
    const aliased = SETTING_KEY_ALIASES[rawKey] ?? rawKey;
    if (!Object.prototype.hasOwnProperty.call(ALLOWED, aliased)) {
      throw new UnprocessableEntityException({
        errors: { key: `unknown setting key: ${rawKey}` },
      });
    }
    return aliased as SettingKey;
  }

  private isType(value: unknown, expected: SettingType): boolean {
    if (expected === 'boolean') return typeof value === 'boolean';
    if (expected === 'string')
      return typeof value === 'string' && value.length > 0;
    return false;
  }
}
