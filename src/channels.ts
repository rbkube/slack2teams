import fs from 'fs';
import _ from 'lodash';
import path from 'path';
import { SLACK_EXPORT_PATH, STATE_DIRECTORY } from './constants';
import MSGraph from './ms-graph';
import { sleep } from './utils';

const readChannels = (filepath: string) => {
  const raw = fs.readFileSync(filepath, 'utf-8');
  return JSON.parse(raw);
};

const sanitizeChannels = (channels: any[]) => {
  return _.map(channels, (channel) => {
    return {
      slackId: channel.id as string,
      name: channel.name as string,
      description: (channel.topic.value as string) ?? (channel.purpose.value as string),
      archived: channel.is_archived as boolean,
      general: channel.is_general as boolean,
      creator: channel.creator as string,
      members: channel.members as string[],
      created: channel.created as number,
    };
  });
};

const mapUsers = (
  channels: ReturnType<typeof sanitizeChannels>,
  mapper: (str: string) => { role: string; id: string } | null
) => {
  return _.map(channels, (channel) => {
    return {
      ...channel,
      creator: mapper(channel.creator),
      members: _.map(channel.members, mapper).filter((v) => !!v),
      created: new Date(channel.created * 1000).toISOString(),
    };
  });
};

const createChannelsGraphPayload = (channels: ReturnType<typeof mapUsers>) => {
  return channels.flatMap((channel) => {
    if (channel.general) return [];
    return [
      {
        slackId: channel.slackId,
        slackName: channel.name,
        archived: channel.archived,
        payload: {
          '@microsoft.graph.channelCreationMode': 'migration',
          displayName: channel.name,
          description: channel.description,
          createdDateTime: channel.created,
        },
      },
    ];
  });
};

const createChannels = async (channels: ReturnType<typeof mapUsers>, teamId: string) => {
  const teamsGeneral = await MSGraph.fetch(`teams/${teamId}/primaryChannel`, {}).then((res) =>
    res.json()
  );
  const generalSlackId = channels.find((channel) => channel.general)?.slackId;
  const channelGraphPayloads = createChannelsGraphPayload(channels);

  const table = [
    {
      slackName: 'general',
      slackId: generalSlackId,
      channelId: teamsGeneral.id as string,
      teamId,
      archived: false,
    },
  ];
  for (const channelPayload of channelGraphPayloads) {
    const res = await MSGraph.fetch(`teams/${teamId}/channels`, {
      method: 'POST',
      body: JSON.stringify(channelPayload.payload),
    });
    const data = await res.json();
    await sleep(200);
    console.log(`Channel ${channelPayload.payload.displayName} created.`);
    table.push({
      slackName: channelPayload.slackName,
      slackId: channelPayload.slackId,
      channelId: data.id as string,
      teamId,
      archived: channelPayload.archived,
    });
  }
  return table;
};

const main = async () => {
  const users = JSON.parse(fs.readFileSync(path.join(STATE_DIRECTORY, 'users.json'), 'utf-8'));
  const keyedUsers = _.keyBy(users, 'slackId');
  const userMapper = (slackId) =>
    keyedUsers[slackId]
      ? { role: _.lowerCase(keyedUsers[slackId].userType), id: keyedUsers[slackId].entraId }
      : null;

  const args = process.argv.slice(2);
  const teamName = args[0] ?? 'Slack Archive';
  await MSGraph.login();

  const raw = readChannels(path.join(SLACK_EXPORT_PATH, 'channels.json'));
  const channels = mapUsers(sanitizeChannels(raw), userMapper);

  const teamCreatedAt = channels.find((channel) => channel.general)?.created;

  console.log('Creating Team in migration mode...');
  console.log('---------------------------------------------------------------');
  const team = await MSGraph.createTeam(teamName, 'Slack Archive Team', teamCreatedAt);
  console.log(`Team ${team.id} created successfully!`);
  console.log('---------------------------------------------------------------');

  console.log('---------------------------------------------------------------');
  console.log('Processing channels data...');
  const channelsResult = await createChannels(channels, team.id);
  console.log('---------------------------------------------------------------');
  console.table(channelsResult);
  const dir = STATE_DIRECTORY;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'channels.json'), JSON.stringify(channelsResult, null, 2));
  console.log(`Channels mapping table saved to '${path.join(dir, 'channels.json')}'!`);
};

main();
