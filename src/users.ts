import { parse } from 'csv-parse/sync';
import fs from 'fs';
import _ from 'lodash';
import path from 'path';
import {
  SLACK_EXPORT_PATH,
  STATE_DIRECTORY,
  TARGET_ENTRA_DOMAIN,
  USER_MIGRATIONS_PATH,
} from './constants';
import MSGraph from './ms-graph';
import { sleep } from './utils';

export interface SanitizedSlackUser {
  id: string;
  email: string;
  displayName: string;
}

const readUsersToMigrate = async (filepath: string) => {
  const raw = fs.readFileSync(filepath, 'utf-8');
  const usersToMigrate = parse(raw, { columns: true, skip_empty_lines: true });
  return _.reduce<any, Record<string, string>>(
    usersToMigrate,
    (acc, next) => {
      return { ...acc, [next.slack]: next.entra };
    },
    {}
  );
};

const readSlackUsers = async (filepath: string) => {
  const raw = fs.readFileSync(filepath, 'utf-8');
  return JSON.parse(raw);
};

const sanitizeSlackUsers = async (users: any[]) => {
  return _.flatMap(users, (user) => {
    if (user.is_bot) return [];
    return [
      {
        id: user.id,
        email: user.profile.email,
        displayName: user.profile.real_name_normalized,
      },
    ];
  }) as SanitizedSlackUser[];
};

const generateArchivedEntraEmail = (originalEmail: string, targetDomain: string) => {
  // Replace dots with underscores and split at the '@' to separate local part from domain
  let transformed = originalEmail.replace(/@/g, '_');

  // Append the custom delimiter and new domain
  transformed += '#MIG#@' + targetDomain;

  return transformed;
};

type Awaited<T> = T extends PromiseLike<infer U> ? U : T;
export type UserMigration = Awaited<ReturnType<typeof computeMigrations>>[number];
export type UserMigrated = UserMigration & { entraId: string; mail: string; userType: string };

const computeMigrations = async (
  users: SanitizedSlackUser[],
  migrationMapPath: string,
  targetDomain: string
) => {
  const migrationDict = await readUsersToMigrate(migrationMapPath);
  const computed = _.map(users, (user) => {
    const extra = {
      entraEmail: migrationDict[user.email] ?? generateArchivedEntraEmail(user.email, targetDomain),
      mail: migrationDict[user.email] ?? user.email,
      userType: migrationDict[user.email] ? 'Member' : 'Guest',
    };

    return {
      slackId: user.id,
      slackEmail: user.email,
      displayName: user.displayName,
      ...extra,
    };
  });
  return computed;
};

const importUsers = async () => {
  const slackUsers = await readSlackUsers(path.join(SLACK_EXPORT_PATH, 'users.json')).then(
    sanitizeSlackUsers
  );
  const userMigrations = await computeMigrations(
    slackUsers,
    USER_MIGRATIONS_PATH,
    TARGET_ENTRA_DOMAIN
  );

  const migrated: UserMigrated[] = [];
  for (const user of userMigrations) {
    console.log(`Migrating user ${user.displayName} with email ${user.entraEmail}`);
    const res = await MSGraph.createOrGetUser(user);
    migrated.push({ ...user, entraId: res.id });
    await sleep(200);
  }

  return migrated;
};

const main = async () => {
  console.log('Logging in...');
  await MSGraph.login();
  console.log('Logged in successfully!');

  console.log('Migrating users...');
  console.log('---------------------------------------------------------------');
  const defaultUser = await MSGraph.createOrGetUser({
    entraEmail: generateArchivedEntraEmail('slackbot', TARGET_ENTRA_DOMAIN),
    displayName: 'slackbot',
    userType: 'Guest',
  });
  const users = await importUsers();
  console.log('---------------------------------------------------------------');

  console.table(users);
  const dir = path.join(STATE_DIRECTORY);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(dir, 'users.json'),
    JSON.stringify(
      {
        default: {
          slackId: null,
          displayName: defaultUser.displayName,
          entraId: defaultUser.id,
          mail: null,
          userType: 'Guest',
          entraEmail: defaultUser.userPrincipalName,
          slackEmail: null,
        },
        users: users,
      },
      null,
      2
    )
  );
  console.log(`Users mapping table saved to '${path.join(dir, 'users.json')}'!`);
};

main();
