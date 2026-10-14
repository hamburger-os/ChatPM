-- ADR-028: discovery reads are non-billable; no persistent cooldown or tracking table.
-- Keep historical 010 migration intact for already-deployed instances.
DROP TABLE IF EXISTS ai_provider_checks;
