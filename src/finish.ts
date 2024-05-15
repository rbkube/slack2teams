import { channel } from 'diagnostics_channel';
import fs from 'fs';
import path from 'path';
import MSGraph, { MSGraphBeta } from './ms-graph';
import _ from 'lodash';
import { STATE_DIRECTORY } from './constants';

const addUserToTeam = async (teamId: string, userId: string, roles: string[] = []) => {
  try {
    return MSGraphBeta.fetch(`/teams/${teamId}/members`, {
      method: 'POST',
      body: JSON.stringify({
        '@odata.type': '#microsoft.graph.aadUserConversationMember',
        'user@odata.bind': `https://graph.microsoft.com/beta/${userId}`,
        roles,
      }),
    }).then((res) => res.json());
  } catch (e) {
    console.dir(e, { depth: null });
  }
};

const main = async () => {
  await MSGraph.login();
  console.log('Finishing migration...');
  console.log('---------------------------------------------------------------');
  const channels = JSON.parse(
    fs.readFileSync(path.join(STATE_DIRECTORY, 'channels.json'), 'utf-8')
  );

  try {
    const teams = {};
    for (const channel of channels) {
      await MSGraph.fetch(
        `teams/${channel.teamId}/channels/${channel.channelId}/completeMigration`,
        { method: 'POST' }
      )
        .then((res) => res.json())
        .catch((err) => {});
      console.log(`Channel ${channel.slackName} exited migration mode.`);
      teams[channel.teamId] = true;
    }

    for (const team of _.keys(teams)) {
      await MSGraph.fetch(`teams/${team}/completeMigration`, { method: 'POST' })
        .then((res) => res.json())
        .catch((err) => {});
      console.log(`Team ${team} exited migration mode.`);
    }
  } catch (error) {
    console.dir(error, { depth: null });
  }
};

main();
