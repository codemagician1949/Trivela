import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { assertCampaignRepository } from './campaignRepository.js';
import { createSqliteCampaignRepository, parseCategoriesConfig } from './sqliteCampaignRepository.js';
import { assertAuditLogRepository } from './auditLogRepository.js';
import { createSqliteAuditLogRepository } from './sqliteAuditLogRepository.js';
import { WebhookRepository } from './webhookRepository.js';
import { createSqliteReferralRepository } from './sqliteReferralRepository.js';
import { assertApiKeyRepository } from './apiKeyRepository.js';
import { createSqliteApiKeyRepository } from './sqliteApiKeyRepository.js';

export async function createDal({
  dbPath = ':memory:',
  campaigns = [],
  campaignRepository,
  auditLogRepository,
  webhookRepository,
  apiKeyRepository,
  allowedCategories,
} = {}) {
  const db = new Database(dbPath);

  // Run migrations on startup for SQLite
  await runMigrations(db);

  const categories = allowedCategories ?? parseCategoriesConfig(process.env.TRIVELA_CATEGORIES);

  return {
    campaigns: assertCampaignRepository(
      campaignRepository
        ?? createSqliteCampaignRepository({
          db,
          seed: campaigns,
          allowedCategories: categories,
        }),
    ),
    auditLogs: assertAuditLogRepository(
      auditLogRepository ?? createSqliteAuditLogRepository({ db }),
    ),
    webhooks: webhookRepository ?? new WebhookRepository(db),
    referrals: createSqliteReferralRepository({ db }),
    apiKeys: assertApiKeyRepository(
      apiKeyRepository ?? createSqliteApiKeyRepository({ db }),
    ),
    db,
  };
}
