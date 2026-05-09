export class Notification {
  id!: string;
  userId!: number;
  type!: string;
  titleTranslations!: Record<string, string>;
  bodyTranslations!: Record<string, string>;
  data!: Record<string, unknown>;
  isRead!: boolean;
  createdAt!: Date;
  readAt!: Date | null;
}
