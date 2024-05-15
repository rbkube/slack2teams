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
    };
  });
};

const createChannelsGraphPayload = (channels: ReturnType<typeof mapUsers>, ownerId?: string) => {
  return channels.flatMap((channel) => {
    if (channel.general) return [];
    return [
      {
        slackId: channel.slackId,
        slackName: channel.name,
        payload: {
          '@microsoft.graph.channelCreationMode': 'migration',
          displayName: channel.name,
          description: channel.description,
          createdDateTime: '2020-03-14T11:22:17.047Z',
        },
      },
    ];
  });
};

const createChannels = async (
  filepath: string,
  teamId: string,
  userMapper: (str: string) => { role: string; id: string } | null
) => {
  const raw = readChannels(filepath);
  const channels = mapUsers(sanitizeChannels(raw), userMapper);
  const teamsGeneral = await MSGraph.fetch(`teams/${teamId}/primaryChannel`, {}).then((res) =>
    res.json()
  );
  const generalSlackId = channels.find((channel) => channel.general)?.slackId;
  const channelGraphPayloads = createChannelsGraphPayload(channels);

  const table = [
    { slackName: 'general', slackId: generalSlackId, channelId: teamsGeneral.id as string, teamId },
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
    });
  }
  return table;
};

const main = async () => {
  const users = JSON.parse(fs.readFileSync(path.join(STATE_DIRECTORY, 'users.json'), 'utf-8'));

  const args = process.argv.slice(2);
  const teamName = args[0] ?? 'Slack Archive';
  await MSGraph.login();

  console.log('Creating Team in migration mode...');
  console.log('---------------------------------------------------------------');
  const team = await MSGraph.createTeam(teamName, 'Slack Archive Team');
  console.log(`Team ${team.id} created successfully!`);
  console.log('---------------------------------------------------------------');

  console.log('---------------------------------------------------------------');
  console.log('Processing channels data...');
  const keyedUsers = _.keyBy(users, 'slackId');
  const channels = await createChannels(
    path.join(SLACK_EXPORT_PATH, 'channels.json'),
    team.id,
    (slackId) =>
      keyedUsers[slackId]
        ? { role: _.lowerCase(keyedUsers[slackId].userType), id: keyedUsers[slackId].entraId }
        : null
  );
  console.log('---------------------------------------------------------------');
  console.table(channels);
  const dir = STATE_DIRECTORY;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'channels.json'), JSON.stringify(channels, null, 2));
  console.log(`Channels mapping table saved to '${path.join(dir, 'channels.json')}'!`);
};

main();
