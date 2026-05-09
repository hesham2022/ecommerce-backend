import { ConversationReport } from '../../../../domain/conversation-report';
import { ConversationReportEntity } from '../entities/conversation-report.entity';

export class ConversationReportMapper {
  static toDomain(entity: ConversationReportEntity): ConversationReport {
    const d = new ConversationReport();
    d.id = entity.id;
    d.conversationId = entity.conversationId;
    d.reporterUserId = entity.reporterUserId;
    d.reason = entity.reason;
    d.status = entity.status;
    d.createdAt = entity.createdAt;
    return d;
  }
}
