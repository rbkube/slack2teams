import fs from 'fs';
import cliload from 'loading-cli';
import _ from 'lodash';
import path from 'path';
import sanitize from 'sanitize-filename';
import { STATE_DIRECTORY } from './constants';
import MSGraph from './ms-graph';
import { processInBatches } from './utils';

const main = async () => {
  try {
    await MSGraph.login();
    const load = cliload('Uploading files').start();

    const channelFolders = JSON.parse(
      fs.readFileSync(path.join(STATE_DIRECTORY, 'channel-folders.json'), 'utf-8')
    );

    const filesMetaRaw = fs.readFileSync(path.join(STATE_DIRECTORY, 'files.json'), 'utf-8');
    const files = _.filter(JSON.parse(filesMetaRaw), (file) => !file.error);

    let number = 0;

    const uploadFile = async (file, totalFiles) => {
      const fileName = sanitize(`${file.id}-${file.name}`, { replacement: '_' });
      const fileContent = fs.readFileSync(file.filepath);
      load.start(`${++number}/${totalFiles} Uploading file: ${file.id}`);
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
      return {
        slackId: file.id,
        contentUrl: spFile.webDavUrl,
        id: guid,
        name: spFile.name,
        contentType,
      };
    };

    const filesUploaded = await processInBatches(files, 4, 8, async (file) => {
      const result = await uploadFile(file, files.length);
      return result;
    });

    fs.writeFileSync(
      path.join(STATE_DIRECTORY, 'files-uploaded.json'),
      JSON.stringify(filesUploaded, null, 2)
    );
    load.succeed(`Success: wrote ${filesUploaded.length} files to state/files-uploaded.json`);
  } catch (e) {
    console.dir(e, { depth: null });
    return;
  }
};

main();
