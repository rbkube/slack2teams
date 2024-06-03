import path from 'path';
import MSGraph from './ms-graph';
import fs from 'fs';
import { STATE_DIRECTORY } from './constants';
import { processInBatches } from './utils';
import cliload from 'loading-cli';

const main = async () => {
  await MSGraph.login();
  const channels = JSON.parse(
    fs.readFileSync(path.join(STATE_DIRECTORY, 'channels.json'), 'utf-8')
  );

  const load = cliload('Fetching channel folders').start();

  const fetchChannelFolder = async (channel) => {
    load.start(`Fetching files folder for channel ${channel.slackName}`);
    const folder = await MSGraph.fetch(
      `teams/${channel.teamId}/channels/${channel.channelId}/filesFolder`,
      {}
    ).then((res) => res.json());
    return {
      slackChannelId: channel.slackId,
      driveItemId: folder.id,
      driveId: folder.parentReference.driveId,
    };
  };

  const channelFolders = await processInBatches(channels, 5, 10, fetchChannelFolder);

  fs.writeFileSync(
    path.join(STATE_DIRECTORY, 'channel-folders.json'),
    JSON.stringify(channelFolders, null, 2)
  );
  load.succeed('Channel folders saved to state/channel-folders.json');
};

main();
