import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

// MSGraph constants
export const ENTRA_CLIENT_ID = process.env.ENTRA_CLIENT_ID;
export const ENTRA_TENANT_ID = process.env.ENTRA_TENANT_ID;
export const ENTRA_CLIENT_SECRET = process.env.ENTRA_CLIENT_SECRET;
export const MS_GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
export const MS_GRAPH_BETA = 'https://graph.microsoft.com/beta';
export const TARGET_ENTRA_DOMAIN = process.env.TARGET_ENTRA_DOMAIN;

// Slack data constants
export const SLACK_EXPORT_PATH = path.join(process.cwd(), process.env.SLACK_EXPORT_PATH);
export const USER_MIGRATIONS_PATH = path.join(process.cwd(), process.env.USER_MIGRATIONS_PATH);

// Internal constants
export const STATE_DIRECTORY = path.join(process.cwd(), 'state');
if (!fs.existsSync(STATE_DIRECTORY)) fs.mkdirSync(STATE_DIRECTORY, { recursive: true });
