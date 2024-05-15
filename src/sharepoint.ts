import path from 'path';
import MSGraph from './ms-graph';
import fs from 'fs';
import { STATE_DIRECTORY } from './constants';

const main = async () => {
  await MSGraph.login();
  const channels = JSON.parse(
    fs.readFileSync(path.join(STATE_DIRECTORY, 'channels.json'), 'utf-8')
  );

  const channelFolders = [];
  for (const channel of channels) {
    console.log(`Fetching files folder for channel ${channel.slackName}`);
    const folder = await MSGraph.fetch(
      `teams/${channel.teamId}/channels/${channel.channelId}/filesFolder`,
      {}
    ).then((res) => res.json());
    const res = {
      slackChannelId: channel.slackId,
      driveItemId: folder.id,
      driveId: folder.parentReference.driveId,
    };
    channelFolders.push(res);
  }

  console.table(channelFolders);
  fs.writeFileSync(
    path.join(STATE_DIRECTORY, 'channel-folders.json'),
    JSON.stringify(channelFolders, null, 2)
  );
  console.log('Channel folders saved to state/channel-folders.json');
};

main();
