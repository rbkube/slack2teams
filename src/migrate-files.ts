import fs from 'fs';
import path from 'path';
import MSGraph from './ms-graph';
import { STATE_DIRECTORY } from './constants';
import sanitize from 'sanitize-filename';
import cliload from 'loading-cli';
import _ from 'lodash';

const main = async () => {
  try {
    await MSGraph.login();
    const load = cliload('Uploading files').start();

    const channelFolders = JSON.parse(
      fs.readFileSync(path.join(STATE_DIRECTORY, 'channel-folders.json'), 'utf-8')
    );

    const filesMetaRaw = fs.readFileSync(path.join(STATE_DIRECTORY, 'files.json'), 'utf-8');
    const files = _.filter(JSON.parse(filesMetaRaw), (file) => !file.error);

    const res = [];
    let number = 0;
    for (const file of files) {
      number++;
      const fileName = sanitize(`${file.id}-${file.name}`, { replacement: '_' });
      const fileContent = fs.readFileSync(file.filepath);
      load.start(`${number}/${files.length} Uploading file: ${file.id}`);
      const contentType = file.mimetype;
      const sharePoint = channelFolders.find((folder) => folder.slackChannelId === file.channelId);
      const spFile = await MSGraph.fetch(
        `/drives/${encodeURIComponent(sharePoint.driveId)}/items/${encodeURIComponent(
          sharePoint.driveItemId
        )}:/${encodeURIComponent(fileName)}:/content`,
        {
          method: 'PUT',
          body: fileContent,
          headers: {
            'Content-Type': contentType,
          },
        }
      )
        .then((res) => res.json())
        .then((res) => {
          return MSGraph.fetch(
            `/drives/${encodeURIComponent(sharePoint.driveId)}/items/${encodeURIComponent(res.id)}`,
            {
              params: {
                $select: 'webDavUrl,eTag,name',
              },
            }
          );
        })
        .then((res) => res.json());

      const guid = spFile.eTag.match(/[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}/gi)[0];
      res.push({
        slackId: file.id,
        contentUrl: spFile.webDavUrl,
        id: guid,
        name: spFile.name,
        contentType,
      });
    }
    fs.writeFileSync(path.join(STATE_DIRECTORY, 'files-uploaded.json'), JSON.stringify(res));
    console.table(res);
  } catch (e) {
    console.dir(e, { depth: null });
    return;
  }
};

main();
